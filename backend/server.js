'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { initKeys }   = require('./storage/keyStore');
const encryptRouter  = require('./routes/encrypt');
const decryptRouter  = require('./routes/decrypt');
const filesRouter    = require('./routes/files');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// API routes
app.use('/api/encrypt', encryptRouter);
app.use('/api/decrypt', decryptRouter);
app.use('/api/files',   filesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', name: 'MLEFPS' });
});

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

// Boot
(async () => {
  try {
    await initKeys();
    app.listen(PORT, () => {
      console.log(`\n✅ MLEFPS server running at http://localhost:${PORT}`);
      console.log(`   Encryption: AES-256-CBC → Triple-DES-CBC → RSA-2048-OAEP`);
      console.log(`   Press Ctrl+C to stop.\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
