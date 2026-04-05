'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const encryptRouter = require('./routes/encrypt');
const decryptRouter = require('./routes/decrypt');
const filesRouter = require('./routes/files');
const userRouter = require('./routes/user');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND = path.join(__dirname, '..', 'frontend');

// ── Helpers ──────────────────────────────────────────────────────────────────
const page = (file) => (_req, res) => res.sendFile(path.join(FRONTEND, file));
const send404 = (_req, res) => res.status(404).sendFile(path.join(FRONTEND, '404.html'));

// ── Guards ───────────────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[ENV] FATAL ERROR: JWT_SECRET environment variable is required.');
  process.exit(1);
}

// ── Middleware ────────────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN || '*';
const corsOptions = corsOrigin === '*'
  ? { origin: '*' }
  : { origin: corsOrigin.split(',').map(o => o.trim()).filter(Boolean) };

app.use(cors(corsOptions));
app.use(express.json());

// ── Frontend (monolith mode) ──────────────────────────────────────────────────
// Enable by setting SERVE_FRONTEND=true in .env
// Disabled by default for Render (API) + Vercel (frontend) split deployments.
if (process.env.SERVE_FRONTEND === 'true') {

  // Only whitelisted extensions are allowed from asset directories.
  // Anything else (e.g. desktop.ini, .html files) → 404.
  const ALLOWED_EXT = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.woff', '.woff2']);
  const assetGuard = (req, res, next) => {
    if (ALLOWED_EXT.has(path.extname(req.path).toLowerCase())) return next();
    return send404(req, res);
  };

  app.use('/css', assetGuard, express.static(path.join(FRONTEND, 'css'), { index: false }));
  app.use('/js', assetGuard, express.static(path.join(FRONTEND, 'js'), { index: false }));
  app.use('/assets', assetGuard, express.static(path.join(FRONTEND, 'assets'), { index: false }));

  // Valid page routes — ONLY these clean URLs are served
  app.get('/', page('landingPage.html'));
  app.get('/home', page('landingPage.html'));
  app.get('/login', page('login.html'));
  app.get('/signup', page('signup.html'));
  app.get('/dashboard', page('index.html'));
}

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/encrypt', encryptRouter);
app.use('/api/decrypt', decryptRouter);
app.use('/api/files', filesRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', name: 'MLEFPS' });
});

// ── Catch-all 404 ─────────────────────────────────────────────────────────────
// Every URL not matched above — including /*.html, /settings, /random — gets 404.
app.use(send404);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
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
