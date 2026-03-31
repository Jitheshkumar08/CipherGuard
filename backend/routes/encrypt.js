'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const { encryptImage } = require('../crypto/cryptoEngine');
const { getPublicKey } = require('../storage/keyStore');

const router        = express.Router();
const UPLOADS_DIR   = path.join(__dirname, '..', 'uploads');
const ENCRYPTED_DIR = path.join(__dirname, '..', 'encrypted');

[UPLOADS_DIR, ENCRYPTED_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}_${file.originalname}`),
});

const ALLOWED = /jpe?g|png|gif|bmp|webp|tiff?/i;

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (ALLOWED.test(ext)) return cb(null, true);
    cb(new Error('Only image files are supported: JPG, PNG, GIF, BMP, WEBP, TIFF'));
  },
});

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
  const uploadedPath = req.file.path;

  try {
    const imageBuffer  = fs.readFileSync(uploadedPath);
    const publicKeyPem = getPublicKey();
    const mlencBuffer  = await encryptImage(imageBuffer, req.file.originalname, publicKeyPem);

    const fileId  = uuidv4();
    const outPath = path.join(ENCRYPTED_DIR, `${fileId}.mlenc`);
    fs.writeFileSync(outPath, mlencBuffer);
    fs.unlinkSync(uploadedPath);

    res.json({
      success:       true,
      fileId,
      filename:      `${fileId}.mlenc`,
      originalName:  req.file.originalname,
      originalSize:  req.file.size,
      encryptedSize: mlencBuffer.length,
    });
  } catch (err) {
    console.error('[Encrypt] Error:', err.message);
    if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    res.status(500).json({ error: 'Encryption failed: ' + err.message });
  }
});

module.exports = router;
