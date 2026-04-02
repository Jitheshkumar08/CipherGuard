'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
const ENCRYPTED_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage'));

if (!fs.existsSync(ENCRYPTED_DIR)) fs.mkdirSync(ENCRYPTED_DIR, { recursive: true });

// GET /api/files — list all encrypted files for the logged in user
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, original_name, stored_name, file_size, created_at FROM encrypted_files WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    const files = result.rows.map(f => ({
      fileId: f.id,
      filename: f.stored_name,
      originalName: f.original_name,
      size: f.file_size,
      createdAt: f.created_at,
    }));

    res.json({ files });
  } catch (err) {
    console.error('[Files API]', err);
    res.status(500).json({ error: 'Failed to fetch files.' });
  }
});

// DELETE /api/files/:fileId — remove an encrypted file owned by the user
router.delete('/:fileId', auth, async (req, res) => {
  const { fileId } = req.params;

  try {
    // Check ownership before delete
    const result = await pool.query(
      'DELETE FROM encrypted_files WHERE id = $1 AND user_id = $2 RETURNING stored_name',
      [fileId, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'File not found or access denied.' });
    }

    const storedName = result.rows[0].stored_name;
    const encPath = path.join(ENCRYPTED_DIR, storedName);

    if (fs.existsSync(encPath)) {
      fs.unlinkSync(encPath);
    }

    res.json({ success: true, message: 'File deleted.' });
  } catch (err) {
    console.error('[Files API Delete]', err);
    res.status(500).json({ error: 'Failed to delete file.' });
  }
});

module.exports = router;
