'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { decryptImage } = require('../crypto/cryptoEngine');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const requireKeys = require('../middleware/requireKeys');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const ENCRYPTED_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage'));

[UPLOADS_DIR, ENCRYPTED_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.tiff': 'image/tiff',
};

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, uuidv4() + '.mlenc'),
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.mlenc' || file.mimetype === 'application/octet-stream') return cb(null, true);
    if (!ext) return cb(null, true);
    cb(new Error('Only .mlenc files are accepted for decryption.'));
  },
});

function sendImage(res, imageBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`,
    'Content-Length': imageBuffer.length,
    'X-Original-Name': encodeURIComponent(originalName),
    'Access-Control-Expose-Headers': 'X-Original-Name',
  });
  res.send(imageBuffer);
}

// POST /api/decrypt — upload .mlenc, receive original image
router.post('/', auth, upload.single('encfile'), requireKeys, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No .mlenc file provided.' });
  const uploadedPath = req.file.path;

  try {
    const mlencBuffer = fs.readFileSync(uploadedPath);
    const privateKeyPem = req.userKeys.privateKeyPem; // User-specific key
    const { imageBuffer, originalName } = await decryptImage(mlencBuffer, privateKeyPem);
    fs.unlinkSync(uploadedPath);
    sendImage(res, imageBuffer, originalName);
  } catch (err) {
    console.error('[Decrypt] Error:', err.message);
    if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    res.status(400).json({ error: err.message, step: err.step || 4 });
  }
});

// GET /api/decrypt/:fileId — decrypt a server-stored .mlenc file by ID
router.get('/:fileId', auth, requireKeys, async (req, res) => {
  const { fileId } = req.params;

  try {
    // 1. Verify ownership securely via DB
    const fileResult = await pool.query('SELECT * FROM encrypted_files WHERE id = $1 AND user_id = $2', [fileId, req.user.id]);
    if (fileResult.rows.length === 0) return res.status(404).json({ error: 'Encrypted file not found or access denied.' });

    const fileRow = fileResult.rows[0];
    const encPath = path.join(ENCRYPTED_DIR, fileRow.stored_name);

    if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'Locally stored encrypted file not found on disk.' });

    const mlencBuffer = fs.readFileSync(encPath);
    const privateKeyPem = req.userKeys.privateKeyPem; // User-specific key
    const { imageBuffer, originalName } = await decryptImage(mlencBuffer, privateKeyPem);
    sendImage(res, imageBuffer, originalName);
  } catch (err) {
    console.error('[Decrypt] Error:', err.message);
    res.status(400).json({ error: err.message, step: err.step || 4 });
  }
});

// GET /api/decrypt/download/:fileId — download the raw .mlenc file
router.get('/download/:fileId', auth, async (req, res) => {
  const { fileId } = req.params;

  try {
    // Verify ownership
    const fileResult = await pool.query('SELECT * FROM encrypted_files WHERE id = $1 AND user_id = $2', [fileId, req.user.id]);
    if (fileResult.rows.length === 0) return res.status(404).json({ error: 'Encrypted file not found or access denied.' });

    const fileRow = fileResult.rows[0];
    const encPath = path.join(ENCRYPTED_DIR, fileRow.stored_name);
    if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'File not found on disk.' });

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileRow.stored_name}"`,
    });
    fs.createReadStream(encPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Server error retrieving file.' });
  }
});

module.exports = router;
