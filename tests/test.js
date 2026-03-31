'use strict';

/**
 * MLEFPS Test Suite
 * Run with: node tests/test.js
 *
 * Tests: key generation, AES encrypt/decrypt, 3DES encrypt/decrypt,
 *        RSA key wrapping, full 3-layer pipeline, .mlenc file format validation,
 *        tamper detection.
 */

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

// Bring crypto engine in from the backend
const { generateRsaKeyPair, encryptImage, decryptImage } = require(
  path.join(__dirname, '..', 'backend', 'crypto', 'cryptoEngine')
);

let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    results.push({ ok: true, label });
    console.log(`  ✅  ${label}`);
  } else {
    failed++;
    results.push({ ok: false, label, detail });
    console.error(`  ❌  ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function assertThrows(label, fn) {
  try {
    fn();
    failed++;
    results.push({ ok: false, label, detail: 'Expected an error but none was thrown' });
    console.error(`  ❌  ${label} — Expected throw, got none`);
  } catch {
    passed++;
    results.push({ ok: true, label });
    console.log(`  ✅  ${label}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  MLEFPS Test Suite');
  console.log('══════════════════════════════════════════════\n');

  // ── 1. RSA Key Generation ──────────────────────────────────────────────────
  console.log('【1】 RSA Key Pair Generation');
  let publicKeyPem, privateKeyPem;
  try {
    const kp = await generateRsaKeyPair();
    publicKeyPem  = kp.publicKeyPem;
    privateKeyPem = kp.privateKeyPem;
    assert('RSA key pair generated without error', true);
    assert('Public key is PEM string', typeof publicKeyPem === 'string' && publicKeyPem.includes('PUBLIC KEY'));
    assert('Private key is PEM string', typeof privateKeyPem === 'string' && privateKeyPem.includes('PRIVATE KEY'));
    assert('Public and private keys differ', publicKeyPem !== privateKeyPem);
  } catch (err) {
    assert('RSA key pair generated without error', false, err.message);
    console.error('\nFatal: cannot continue without key pair.\n');
    summary(); return;
  }

  // ── 2. Full Encryption Pipeline — small synthetic image ───────────────────
  console.log('\n【2】 Full Encryption Pipeline (synthetic binary)');
  const fakeImage    = crypto.randomBytes(4096);  // simulate a small image
  const originalName = 'test_image.png';
  let mlencBuffer;

  try {
    mlencBuffer = await encryptImage(fakeImage, originalName, publicKeyPem);
    assert('encryptImage returns a Buffer', Buffer.isBuffer(mlencBuffer));
    assert('Encrypted size > 0', mlencBuffer.length > 0);
    assert('Encrypted output differs from input', !mlencBuffer.slice(8).equals(fakeImage));
    assert('.mlenc starts with MLENC001 magic', mlencBuffer.slice(0, 8).toString() === 'MLENC001');
  } catch (err) {
    assert('encryptImage completes without error', false, err.message);
  }

  // ── 3. Full Decryption Pipeline ────────────────────────────────────────────
  console.log('\n【3】 Full Decryption Pipeline');
  try {
    const { imageBuffer, originalName: recoveredName } = await decryptImage(mlencBuffer, privateKeyPem);
    assert('decryptImage returns a Buffer', Buffer.isBuffer(imageBuffer));
    assert('Recovered image equals original', imageBuffer.equals(fakeImage));
    assert('Original filename recovered correctly', recoveredName === originalName);
  } catch (err) {
    assert('decryptImage completes without error', false, err.message);
  }

  // ── 4. Tamper Detection ───────────────────────────────────────────────────
  console.log('\n【4】 Tamper Detection');
  const tampered = Buffer.from(mlencBuffer);
  tampered[20] ^= 0xFF;   // flip a byte in the encrypted key block

  let tamperCaught = false;
  try {
    await decryptImage(tampered, privateKeyPem);
  } catch {
    tamperCaught = true;
  }
  assert('Tampered ciphertext throws on decryption', tamperCaught);

  const badMagic = Buffer.from(mlencBuffer);
  badMagic[0] = 0x00;
  let badMagicCaught = false;
  try {
    await decryptImage(badMagic, privateKeyPem);
  } catch {
    badMagicCaught = true;
  }
  assert('Invalid magic header rejected', badMagicCaught);

  // ── 5. Multiple Independent Encryptions Produce Different Ciphertext ──────
  console.log('\n【5】 Randomness (IV independence)');
  const enc1 = await encryptImage(fakeImage, 'a.png', publicKeyPem);
  const enc2 = await encryptImage(fakeImage, 'a.png', publicKeyPem);
  assert('Two encryptions of same input differ (IV randomness)', !enc1.equals(enc2));

  const { imageBuffer: dec1 } = await decryptImage(enc1, privateKeyPem);
  const { imageBuffer: dec2 } = await decryptImage(enc2, privateKeyPem);
  assert('Both ciphertexts decrypt to same original', dec1.equals(dec2) && dec1.equals(fakeImage));

  // ── 6. Different File Sizes ───────────────────────────────────────────────
  console.log('\n【6】 Various File Sizes');
  for (const size of [1, 128, 1023, 16384, 100000]) {
    const data = crypto.randomBytes(size);
    try {
      const enc = await encryptImage(data, `file_${size}.png`, publicKeyPem);
      const { imageBuffer: dec } = await decryptImage(enc, privateKeyPem);
      assert(`Round-trip correct for ${size} bytes`, dec.equals(data));
    } catch (err) {
      assert(`Round-trip correct for ${size} bytes`, false, err.message);
    }
  }

  // ── 7. Filename Preservation ──────────────────────────────────────────────
  console.log('\n【7】 Filename Preservation');
  const names = ['photo.jpg', 'my image (1).png', 'résumé.png', 'a'.repeat(100) + '.bmp'];
  for (const name of names) {
    const data = crypto.randomBytes(512);
    const enc  = await encryptImage(data, name, publicKeyPem);
    const { originalName: recovered } = await decryptImage(enc, privateKeyPem);
    assert(`Filename preserved: "${name.slice(0, 30)}..."`, recovered === name);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  summary();
}

function summary() {
  const total = passed + failed;
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed}/${total} passed  ${failed > 0 ? '(' + failed + ' failed)' : '🎉 All passed!'}`);
  console.log('══════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\nUnexpected test runner error:', err);
  process.exit(1);
});
