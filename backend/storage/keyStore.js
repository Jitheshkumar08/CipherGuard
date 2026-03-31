'use strict';

const fs   = require('fs');
const path = require('path');
const { generateRsaKeyPair } = require('../crypto/cryptoEngine');

const KEYS_DIR      = path.join(__dirname, '..', 'keys');
const PUBLIC_KEY_FILE  = path.join(KEYS_DIR, 'public.pem');
const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'private.pem');

/**
 * Ensure the keys directory exists and generate RSA key pair if not present.
 * Call this once at server startup.
 */
async function initKeys() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  if (!fs.existsSync(PUBLIC_KEY_FILE) || !fs.existsSync(PRIVATE_KEY_FILE)) {
    console.log('[KeyStore] Generating RSA-2048 key pair — this may take a moment...');
    const { publicKeyPem, privateKeyPem } = await generateRsaKeyPair();
    fs.writeFileSync(PUBLIC_KEY_FILE,  publicKeyPem,  { encoding: 'utf8', mode: 0o644 });
    fs.writeFileSync(PRIVATE_KEY_FILE, privateKeyPem, { encoding: 'utf8', mode: 0o600 }); // private key: owner read-only
    console.log('[KeyStore] RSA key pair saved to /backend/keys/');
  } else {
    console.log('[KeyStore] Existing RSA key pair loaded.');
  }
}

function getPublicKey() {
  return fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
}

function getPrivateKey() {
  return fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
}

module.exports = { initKeys, getPublicKey, getPrivateKey };
