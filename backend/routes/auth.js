const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { generateUserKeys } = require('../crypto/userKeyManager');
const auth = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '10h';

/**
 * SIGNUP
 */
router.post('/signup', [
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required.')
        .isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters long.')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can contain only letters, numbers, and underscore (_).'),
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required.')
        .isEmail().withMessage('Please enter a valid email address.')
        .normalizeEmail(),
    body('password')
        .notEmpty().withMessage('Password is required.')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Please fix the highlighted signup fields.',
            errors: errors.array().map((e) => ({ field: e.path, msg: e.msg }))
        });
    }

    const { username, email, password } = req.body;

    try {
        // 1. Check if username/email already exist and return all collisions
        const existsQuery = await pool.query(
            `SELECT
                EXISTS (SELECT 1 FROM users WHERE email = $1) AS email_exists,
                EXISTS (SELECT 1 FROM users WHERE username = $2) AS username_exists`,
            [email, username]
        );

        const { email_exists, username_exists } = existsQuery.rows[0];
        if (email_exists || username_exists) {
            const signupErrors = [];
            if (username_exists) signupErrors.push({ field: 'username', msg: 'Username is already taken.' });
            if (email_exists) signupErrors.push({ field: 'email', msg: 'Email is already in use.' });
            return res.status(400).json({
                error: 'Account creation failed due to duplicate fields.',
                errors: signupErrors
            });
        }

        // 2. Hash password
        const password_hash = await bcrypt.hash(password, 12);

        // 3. Generate keys
        const keys = await generateUserKeys(password);

        // 4. Store user in DB
        const insertQuery = `
            INSERT INTO users (
                username, email, password_hash, 
                encrypted_dek, dek_iv, kek_salt, 
                encrypted_private_key, public_key, rsa_iv
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, username, email
        `;
        const insertParams = [
            username, email, password_hash,
            keys.encrypted_dek, keys.dek_iv, keys.kek_salt,
            keys.encrypted_private_key, keys.public_key, keys.rsa_iv
        ];

        const newUserResult = await pool.query(insertQuery, insertParams);
        const user = newUserResult.rows[0];

        // 5. Issue token
        const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.status(201).json({ token, user });
    } catch (err) {
        if (err && err.code === '23505') {
            const detail = String(err.detail || '').toLowerCase();
            const signupErrors = [];
            if (detail.includes('(username)')) signupErrors.push({ field: 'username', msg: 'Username is already taken.' });
            if (detail.includes('(email)')) signupErrors.push({ field: 'email', msg: 'Email is already in use.' });
            if (signupErrors.length === 0) signupErrors.push({ field: 'signup', msg: 'Username or email already exists.' });

            return res.status(400).json({
                error: 'Account creation failed due to duplicate fields.',
                errors: signupErrors
            });
        }

        console.error('[Signup]', err);
        res.status(500).json({ error: 'Internal server error during signup.' });
    }
});

/**
 * LOGIN
 */
router.post('/login', [
    body('login').exists().trim(),
    body('password').exists()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { login, password } = req.body;

    try {
        const isEmail = login.includes('@');
        const result = isEmail
            ? await pool.query('SELECT * FROM users WHERE email = $1', [login])
            : await pool.query('SELECT * FROM users WHERE username = $1', [login]);

        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials.' });

        const user = result.rows[0];

        // Validate password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

        // NOTE: We don't unlock keys here. Keys are unlocked only when an encrypt/decrypt request is made
        // by the requireKeys middleware.

        // Issue token
        const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (err) {
        console.error('[Login]', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

/**
 * REFRESH (sliding session)
 */
router.post('/refresh', auth, async (req, res) => {
    try {
        const token = jwt.sign({ sub: req.user.id, username: req.user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({ token });
    } catch (err) {
        console.error('[Refresh]', err);
        res.status(500).json({ error: 'Failed to refresh session.' });
    }
});

/**
 * DEBUG: Token Info (for production troubleshooting)
 */
router.get('/debug/token-info', auth, (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(400).json({ error: 'No token in request.' });

    try {
        const parts = token.split('.');
        if (parts.length !== 3) return res.status(400).json({ error: 'Invalid token format.' });

        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const nowSec = Math.floor(Date.now() / 1000);
        const expSec = payload.exp;
        const remainingSec = expSec - nowSec;

        res.json({
            user: req.user,
            issuedAt: new Date(payload.iat * 1000).toISOString(),
            expiresAt: new Date(expSec * 1000).toISOString(),
            remainingSeconds: Math.max(0, remainingSec),
            remainingHours: (remainingSec / 3600).toFixed(2),
            isExpired: remainingSec <= 0,
            effectiveJwtExpiry: process.env.JWT_EXPIRES_IN || '10h'
        });
    } catch (err) {
        res.status(400).json({ error: 'Failed to decode token.' });
    }
});

/**
 * LOGOUT
 */
router.post('/logout', (req, res) => {
    // With pure JWT, logout is largely handled on the client by destroying the token.
    // If we wanted to blacklist tokens, we'd do it here.
    res.json({ status: 'ok' });
});

module.exports = router;
