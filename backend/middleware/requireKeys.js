const pool = require('../db/pool');
const bcrypt = require('bcrypt');
const { unlockUserKeys } = require('../crypto/userKeyManager');

module.exports = async (req, res, next) => {
    // Requires that auth.js middleware has already run and populated req.user
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'User must be authenticated first.' });
    }

    const password = req.body?.password || req.headers['x-user-password'];
    if (!password) {
        return res.status(400).json({ error: 'Password is required to unlock encryption keys.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

        const userRow = result.rows[0];

        // Validate password to ensure they have the right to derive keys
        const valid = await bcrypt.compare(password, userRow.password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect password. Cannot unlock keys.' });

        // Unlock keys
        const keys = unlockUserKeys(userRow, password);

        // Attach to request
        req.userKeys = keys;

        next();
    } catch (e) {
        console.error('[requireKeys Middleware]', e);
        res.status(500).json({ error: 'Failed to unlock encryption keys.' });
    }
};
