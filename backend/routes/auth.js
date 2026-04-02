const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { generateUserKeys } = require('../crypto/userKeyManager');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * SIGNUP
 */
router.post('/signup', [
    body('username').trim().isLength({ min: 3 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, email, password } = req.body;

    try {
        // 1. Check if user exists
        let result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length > 0) return res.status(400).json({ error: 'Email already in use.' });

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
 * LOGOUT
 */
router.post('/logout', (req, res) => {
    // With pure JWT, logout is largely handled on the client by destroying the token.
    // If we wanted to blacklist tokens, we'd do it here.
    res.json({ status: 'ok' });
});

module.exports = router;
