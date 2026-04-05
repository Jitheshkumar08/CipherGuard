const crypto = require('crypto');
const { generateRsaKeyPair } = require('./cryptoEngine');

// Config
const KEK_ITERATIONS = 200000;
const KEK_LEN = 32; // 256 bits
const KEK_DIGEST = 'sha256';

/**
 * Derives a Key Encrypting Key (KEK) from a password and salt.
 * @param {string} password 
 * @param {string} saltBase64 
 * @returns {Buffer} 32-byte KEK
 */
function deriveKek(password, saltBase64) {
  const salt = Buffer.from(saltBase64, 'base64');
  return crypto.pbkdf2Sync(password, salt, KEK_ITERATIONS, KEK_LEN, KEK_DIGEST);
}

/**
 * Encrypts data (DEK or RSA private key) using AES-256-GCM
 * @param {Buffer|string} plaintext 
 * @param {Buffer} key 32-byte key
 * @returns {Object} { ciphertext: string(base64), iv: string(base64) }
 */
function encryptGcm(plaintext, key) {
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(plaintext);
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // We'll append authTag to ciphertext for easy storage
  const finalCiphertext = Buffer.concat([ciphertext, authTag]);

  return {
    ciphertext: finalCiphertext.toString('base64'),
    iv: iv.toString('base64')
  };
}

/**
 * Decrypts data using AES-256-GCM
 * @param {string} ciphertextBase64 
 * @param {string} ivBase64 
 * @param {Buffer} key 32-byte key
 * @returns {Buffer} decrypted data
 */
function decryptGcm(ciphertextBase64, ivBase64, key) {
  const iv = Buffer.from(ivBase64, 'base64');
  const finalCiphertext = Buffer.from(ciphertextBase64, 'base64');
  
  // Extract authTag from the end
  const authTag = finalCiphertext.slice(finalCiphertext.length - 16);
  const ciphertext = finalCiphertext.slice(0, finalCiphertext.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted;
}

/**
 * Perform all initial generation for a new user
 * @param {string} password 
 */
async function generateUserKeys(password) {
  // 1. Generate KEK salt and KEK
  const kekSalt = crypto.randomBytes(16);
  const kek = deriveKek(password, kekSalt.toString('base64'));

  // 2. Generate DEK (Data Encryption Key) master key
  const dek = crypto.randomBytes(32);

  // 3. Encrypt DEK with KEK
  const dekEnc = encryptGcm(dek, kek);

  // 4. Generate RSA pair
  const { publicKeyPem, privateKeyPem } = await generateRsaKeyPair();

  // 5. Encrypt RSA private key with DEK
  const rsaEnc = encryptGcm(Buffer.from(privateKeyPem, 'utf8'), dek);

  return {
    kek_salt: kekSalt.toString('base64'),
    encrypted_dek: dekEnc.ciphertext,
    dek_iv: dekEnc.iv,
    public_key: publicKeyPem,
    encrypted_private_key: rsaEnc.ciphertext,
    rsa_iv: rsaEnc.iv
  };
}

/**
 * Unlock a user's keys using their password
 * @param {Object} userRow DB row containing salt and encrypted keys
 * @param {string} password 
 * @returns {Object} { dek: Buffer, privateKeyPem: string, publicKeyPem: string }
 */
function unlockUserKeys(userRow, password) {
  try {
    // 1. Derive KEK
    const kek = deriveKek(password, userRow.kek_salt);

    // 2. Decrypt DEK
    const dek = decryptGcm(userRow.encrypted_dek, userRow.dek_iv, kek);

    // 3. Decrypt RSA private key
    const privateKeyBuf = decryptGcm(userRow.encrypted_private_key, userRow.rsa_iv, dek);

    return {
      dek,
      privateKeyPem: privateKeyBuf.toString('utf8'),
      publicKeyPem: userRow.public_key
    };
  } catch (err) {
    throw new Error('Key decryption failed: Invalid password or corrupted keys');
  }
}

module.exports = {
  generateUserKeys,
  unlockUserKeys,
  deriveKek,
  encryptGcm,
  decryptGcm
};
