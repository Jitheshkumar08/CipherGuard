'use strict';

const crypto = require('crypto');
const forge = require('node-forge');

const MLENC_MAGIC = Buffer.from('MLENC001', 'ascii');
const MAGIC_LEN = 8;
const KEY_LEN_SIZE = 4;
const NAME_LEN_SIZE = 2;
const MIN_HEADER = MAGIC_LEN + KEY_LEN_SIZE + NAME_LEN_SIZE;

const AES_KEY = 32, AES_IV = 16, DES_KEY = 24, DES_IV = 8;
const KEY_BUNDLE_SIZE = AES_KEY + AES_IV + DES_KEY + DES_IV; // 80 bytes

function generateSymmetricKeys() {
  return {
    aesKey: crypto.randomBytes(AES_KEY),
    aesIv: crypto.randomBytes(AES_IV),
    desKey: crypto.randomBytes(DES_KEY),
    desIv: crypto.randomBytes(DES_IV),
  };
}

function generateRsaKeyPair() {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
      if (err) return reject(new Error('RSA key generation failed: ' + err.message));
      resolve({
        publicKeyPem: forge.pki.publicKeyToPem(keypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(keypair.privateKey),
      });
    });
  });
}

function aesEncrypt(data, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesDecrypt(data, key, iv) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  try { return Buffer.concat([decipher.update(data), decipher.final()]); }
  catch { throw new Error('AES decryption failed — wrong key/IV or corrupted data'); }
}

function desEncrypt(data, key, iv) {
  const cipher = crypto.createCipheriv('des-ede3-cbc', key, iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function desDecrypt(data, key, iv) {
  const decipher = crypto.createDecipheriv('des-ede3-cbc', key, iv);
  try { return Buffer.concat([decipher.update(data), decipher.final()]); }
  catch { throw new Error('3DES decryption failed — wrong key/IV or corrupted data'); }
}

function rsaEncryptKeys(keys, publicKeyPem) {
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const payload = Buffer.concat([keys.aesKey, keys.aesIv, keys.desKey, keys.desIv]);
  const forgeBytes = forge.util.binary.raw.encode(new Uint8Array(payload));
  const encrypted = publicKey.encrypt(forgeBytes, 'RSA-OAEP', { md: forge.md.sha256.create() });
  return Buffer.from(forge.util.binary.raw.decode(encrypted));
}

function rsaDecryptKeys(encryptedKeyBuf, privateKeyPem) {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const forgeBytes = forge.util.binary.raw.encode(new Uint8Array(encryptedKeyBuf));
  let decrypted;
  try { decrypted = privateKey.decrypt(forgeBytes, 'RSA-OAEP', { md: forge.md.sha256.create() }); }
  catch { throw new Error('RSA key decryption failed — wrong private key or corrupted key block'); }
  const buf = Buffer.from(forge.util.binary.raw.decode(decrypted));
  if (buf.length !== KEY_BUNDLE_SIZE) throw new Error(`Key bundle size mismatch: got ${buf.length}, expected ${KEY_BUNDLE_SIZE}`);
  return {
    aesKey: buf.slice(0, 32),
    aesIv: buf.slice(32, 48),
    desKey: buf.slice(48, 72),
    desIv: buf.slice(72, 80),
  };
}

function buildMlencFile(ciphertext, encryptedKeys, originalName) {
  const nameBuf = Buffer.from(originalName, 'utf8');
  const keyLenBuf = Buffer.allocUnsafe(4); keyLenBuf.writeUInt32BE(encryptedKeys.length, 0);
  const nameLenBuf = Buffer.allocUnsafe(2); nameLenBuf.writeUInt16BE(nameBuf.length, 0);
  return Buffer.concat([MLENC_MAGIC, keyLenBuf, encryptedKeys, nameLenBuf, nameBuf, ciphertext]);
}

function parseMlencFile(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('Input is not a Buffer — received: ' + typeof buf);
  if (buf.length < MIN_HEADER) throw new Error(`File too small: ${buf.length} bytes (minimum ${MIN_HEADER})`);

  let offset = 0;
  const magic = buf.slice(offset, offset + MAGIC_LEN); offset += MAGIC_LEN;

  if (!magic.equals(MLENC_MAGIC)) {
    throw new Error(
      `Header magic mismatch.\n` +
      `Expected: ${MLENC_MAGIC.toString('hex')} ("MLENC001")\n` +
      `Got:      ${magic.toString('hex')} ("${magic.toString('ascii').replace(/[^\x20-\x7E]/g, '?')}")\n\n` +
      `This usually means:\n` +
      `  • You uploaded a file NOT encrypted by MLEFPS\n` +
      `  • The file was encrypted by an older/different version\n` +
      `  • The file was corrupted during download or transfer\n` +
      `  • The browser re-encoded the binary during upload\n\n` +
      `Solution: Re-encrypt the original image and use that fresh .mlenc file.`
    );
  }

  if (offset + KEY_LEN_SIZE > buf.length) throw new Error('Truncated file: cannot read key block length');
  const keyLen = buf.readUInt32BE(offset); offset += KEY_LEN_SIZE;
  if (keyLen === 0 || keyLen > 512) throw new Error(`Decryption Failed - Invalid key block length: ${keyLen}`);
  if (offset + keyLen > buf.length) throw new Error('Decryption Failed - Truncated file: key block extends past EOF');
  const encryptedKeys = buf.slice(offset, offset + keyLen); offset += keyLen;

  if (offset + NAME_LEN_SIZE > buf.length) throw new Error('Decryption Failed - Truncated file: cannot read filename length');
  const nameLen = buf.readUInt16BE(offset); offset += NAME_LEN_SIZE;
  if (offset + nameLen > buf.length) throw new Error('Decryption Failed - Truncated file: filename extends past EOF');
  const originalName = buf.slice(offset, offset + nameLen).toString('utf8'); offset += nameLen;

  if (offset >= buf.length) throw new Error('Decryption Failed - Truncated file: no ciphertext after header');
  const ciphertext = buf.slice(offset);

  return { encryptedKeys, originalName, ciphertext };
}

async function encryptImage(imageBuffer, originalName, publicKeyPem) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) throw new Error('Empty image buffer');
  const keys = generateSymmetricKeys();
  const layer1 = aesEncrypt(imageBuffer, keys.aesKey, keys.aesIv);
  const layer2 = desEncrypt(layer1, keys.desKey, keys.desIv);
  const encryptedKeys = rsaEncryptKeys(keys, publicKeyPem);
  return buildMlencFile(layer2, encryptedKeys, originalName);
}

async function decryptImage(mlencBuffer, privateKeyPem) {
  const { encryptedKeys, originalName, ciphertext } = parseMlencFile(mlencBuffer);
  const keys = rsaDecryptKeys(encryptedKeys, privateKeyPem);
  const layer1 = desDecrypt(ciphertext, keys.desKey, keys.desIv);
  const imageBuffer = aesDecrypt(layer1, keys.aesKey, keys.aesIv);
  return { imageBuffer, originalName };
}

module.exports = { generateRsaKeyPair, encryptImage, decryptImage };
