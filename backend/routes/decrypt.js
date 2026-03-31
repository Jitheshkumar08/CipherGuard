'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const { decryptImage }  = require('../crypto/cryptoEngine');
const { getPrivateKey } = require('../storage/keyStore');

const router = express.Router();
const UPLOADS_DIR   = path.join(__dirname, '..', 'uploads');
const ENCRYPTED_DIR = path.join(__dirname, '..', 'encrypted');

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.gif': 'image/gif',
  '.bmp': 'image/bmp',  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
};

// FIX: multer must store .mlenc as binary — use memoryStorage so no
// filesystem encoding is applied. For large files, diskStorage is fine
// because Node fs.readFileSync always reads as raw bytes.
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, uuidv4() + '.mlenc'),
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Accept .mlenc OR application/octet-stream (some browsers send this)
    if (ext === '.mlenc' || file.mimetype === 'application/octet-stream') return cb(null, true);
    // Also accept if no extension info is available but user forced it
    if (!ext) return cb(null, true);
    cb(new Error('Only .mlenc files are accepted for decryption.'));
  },
});

function sendImage(res, imageBuffer, originalName) {
  const ext         = path.extname(originalName).toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  res.set({
    'Content-Type':        contentType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`,
    'Content-Length':      imageBuffer.length,
    'X-Original-Name':     encodeURIComponent(originalName),
    'Access-Control-Expose-Headers': 'X-Original-Name',
  });
  res.send(imageBuffer);
}

// POST /api/decrypt — upload .mlenc, receive original image
router.post('/', upload.single('encfile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No .mlenc file provided.' });
  const uploadedPath = req.file.path;

  try {
    // Read as raw bytes — this is the critical fix
    const mlencBuffer   = fs.readFileSync(uploadedPath);
    const privateKeyPem = getPrivateKey();
    const { imageBuffer, originalName } = await decryptImage(mlencBuffer, privateKeyPem);
    fs.unlinkSync(uploadedPath);
    sendImage(res, imageBuffer, originalName);
  } catch (err) {
    console.error('[Decrypt] Error:', err.message);
    if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/decrypt/:fileId — decrypt a server-stored .mlenc file by ID
router.get('/:fileId', async (req, res) => {
  const { fileId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return res.status(400).json({ error: 'Invalid file ID.' });

  const encPath = path.join(ENCRYPTED_DIR, `${fileId}.mlenc`);
  if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'Encrypted file not found.' });

  try {
    const mlencBuffer   = fs.readFileSync(encPath);
    const privateKeyPem = getPrivateKey();
    const { imageBuffer, originalName } = await decryptImage(mlencBuffer, privateKeyPem);
    sendImage(res, imageBuffer, originalName);
  } catch (err) {
    console.error('[Decrypt] Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/decrypt/download/:fileId — download the raw .mlenc file
// CRITICAL FIX: must set Content-Type: application/octet-stream
// so the browser never re-encodes the binary as text
router.get('/download/:fileId', (req, res) => {
  const { fileId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return res.status(400).json({ error: 'Invalid file ID.' });

  const encPath = path.join(ENCRYPTED_DIR, `${fileId}.mlenc`);
  if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'File not found.' });

  res.set({
    'Content-Type':        'application/octet-stream',  // ← critical
    'Content-Disposition': `attachment; filename="${fileId}.mlenc"`,
  });
  fs.createReadStream(encPath).pipe(res);
});

module.exports = router;
