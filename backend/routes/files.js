'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router        = express.Router();
const ENCRYPTED_DIR = path.join(__dirname, '..', 'encrypted');

// GET /api/files — list all encrypted files on the server
router.get('/', (req, res) => {
  if (!fs.existsSync(ENCRYPTED_DIR)) {
    return res.json({ files: [] });
  }

  const files = fs.readdirSync(ENCRYPTED_DIR)
    .filter(f => f.endsWith('.mlenc'))
    .map(f => {
      const stat  = fs.statSync(path.join(ENCRYPTED_DIR, f));
      const fileId = f.replace('.mlenc', '');
      return {
        fileId,
        filename: f,
        size: stat.size,
        createdAt: stat.birthtime,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ files });
});

// DELETE /api/files/:fileId — remove an encrypted file
router.delete('/:fileId', (req, res) => {
  const { fileId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) {
    return res.status(400).json({ error: 'Invalid file ID.' });
  }

  const encPath = path.join(ENCRYPTED_DIR, `${fileId}.mlenc`);
  if (!fs.existsSync(encPath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  fs.unlinkSync(encPath);
  res.json({ success: true, message: 'File deleted.' });
});

module.exports = router;
