'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { encryptGcm, decryptGcm, deriveKek } = require('../crypto/userKeyManager');
const requireKeys = require('../middleware/requireKeys');

const router = express.Router();
router.use(auth);

// GET /api/user/me
router.get('/me', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, created_at FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/user/password (Change Password - requires re-encrypting DEK)
router.put('/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Invalid password format (min 8 chars).' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const userRow = result.rows[0];

        // 1. Verify old
        const valid = await bcrypt.compare(currentPassword, userRow.password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect current password.' });

        // 2. Decrypt DEK with old KEK
        const oldKek = deriveKek(currentPassword, userRow.kek_salt);
        let dek;
        try {
            dek = decryptGcm(userRow.encrypted_dek, userRow.dek_iv, oldKek);
        } catch {
            return res.status(500).json({ error: 'Failed to unlock DEK with old password.' });
        }

        // 3. Hash new password
        const password_hash = await bcrypt.hash(newPassword, 12);

        // 4. Derive new KEK (generate new salt for good measure)
        const crypto = require('crypto');
        const kek_salt_buf = crypto.randomBytes(16);
        const kek_salt = kek_salt_buf.toString('base64');
        const newKek = deriveKek(newPassword, kek_salt);

        // 5. Re-encrypt DEK with new KEK
        const dekEnc = encryptGcm(dek, newKek);

        // 6. Update DB
        await pool.query(
            'UPDATE users SET password_hash = $1, kek_salt = $2, encrypted_dek = $3, dek_iv = $4 WHERE id = $5',
            [password_hash, kek_salt, dekEnc.ciphertext, dekEnc.iv, req.user.id]
        );

        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
        console.error('[User Password]', err);
        res.status(500).json({ error: 'Failed to update password.' });
    }
});

// Settings: Username & Email are trivial updates
router.put('/profile', async (req, res) => {
    const { username, email } = req.body;
    try {
        await pool.query('UPDATE users SET username = $1, email = $2 WHERE id = $3', [username, email, req.user.id]);

        // Re-issue JWT with new username if it changed
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) return res.status(500).json({ error: 'Server misconfiguration: JWT secret missing.' });
        const token = jwt.sign({ sub: req.user.id, username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ Object: { username, email }, token });
    } catch (err) {
        res.status(500).json({ error: 'Email or username may already be in use.' });
    }
});

// GET /api/user/private-key
// Uses requireKeys middleware which safely expects x-user-password in headers
router.get('/private-key', requireKeys, (req, res) => {
    res.json({ privateKey: req.userKeys.privateKeyPem });
});

// POST /api/user/validate (check uniqueness of username or email)
router.post('/validate', async (req, res) => {
    const { field, value } = req.body;
    const fieldMap = {
        username: 'username',
        email: 'email'
    };
    const column = fieldMap[field];
    if (!column) return res.status(400).json({ error: 'Invalid field' });

    try {
        const result = await pool.query(`SELECT id FROM users WHERE ${column} = $1`, [value]);
        // If length > 0, it exists, but we also want to allow it if it's the current user's own value
        if (result.rows.length > 0 && result.rows[0].id !== req.user.id) {
            return res.json({ available: false });
        }
        res.json({ available: true });
    } catch (err) {
        res.status(500).json({ error: 'Validation failed' });
    }
});

module.exports = router;
