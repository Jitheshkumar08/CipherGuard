'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const encryptRouter = require('./routes/encrypt');
const decryptRouter = require('./routes/decrypt');
const filesRouter = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error('[ENV] FATAL ERROR: JWT_SECRET environment variable is required.');
  process.exit(1);
}

const corsOrigin = process.env.CORS_ORIGIN || '*';
const corsOptions = corsOrigin === '*'
  ? { origin: '*' }
  : { origin: corsOrigin.split(',').map(o => o.trim()).filter(Boolean) };

app.use(cors(corsOptions));
app.use(express.json());

// Optional monolith mode: serve frontend from backend.
// Keep disabled for Render (API) + Vercel (frontend) split deployments.
if (process.env.SERVE_FRONTEND === 'true') {
  app.use(express.static(path.join(__dirname, '..', 'frontend')));
}

// API routes
const userRouter = require('./routes/user');
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/encrypt', encryptRouter);
app.use('/api/decrypt', decryptRouter);
app.use('/api/files', filesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', name: 'MLEFPS' });
});

if (process.env.SERVE_FRONTEND === 'true') {
  // Serve index.html for all other routes (SPA fallback)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

// Boot
(async () => {
  try {
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
