'use strict';

/**
 * String encryption/decryption using AES-256
 */

const crypto = require('crypto');

// encryption parameters
const
  // crypto algorithm
  algorithm = 'aes-256-ctr',
  // algorithm's keylength in bytes (256 bit)
  keyLength = 32,
  // IV length in bytes
  ivLength = 16,
  // salt len in bytes for pbkdf2
  saltLength = 8,
  // digest algorithm for pbkdf2
  digest = 'sha256',
  // iterations for pbkdf2
  iterations = 10000;

/**
 * Creates key and init vector based on password
 * @param password
 * @param callback (error, encrypted buffer)
 */
function createKeyIv(password, callback) {
  // generate salt
  const salt = crypto.randomBytes(saltLength);
  // generate IV
  const iv = crypto.randomBytes(ivLength);
  // derive encryption key from password & salt
  crypto.pbkdf2(password, salt, iterations, keyLength, digest, function (err, key) {
    if (err) {
      callback(err);
    }
    callback(null, {
      salt: salt,
      key: key,
      iv: iv
    });
  });
}

/**
 * Encrypts data
 * @param password
 * @param data
 * @param callback
 */
function encrypt(password, data, callback) {
  // prepare encryption key & IV
  createKeyIv(password, function (err, key) {
    if (err) {
      return callback(err);
    }
    // encipher data
    const cipher = crypto.createCipheriv(algorithm, key.key, key.iv);
    const result = Buffer.concat([key.iv, key.salt, cipher.update(data, 'utf8'), cipher.final()]);
    callback(null, result);
  });
}

/**
 * Decrypts data
 * @param password
 * @param data
 * @param callback (error, decrypted buffer)
 */
function decrypt(password, data, callback) {
  // convert from base64
  const cypherText = Buffer.from(data);
  // read IV
  const iv = cypherText.slice(0, ivLength);
  // read salt
  const salt = cypherText.slice(ivLength, ivLength + saltLength);
  // read encrypted text
  const encrypted = cypherText.slice(ivLength + saltLength);
  // derive key from password & salt
  crypto.pbkdf2(password, salt, iterations, keyLength, digest, function (err, key) {
    if (err) {
      return callback(err);
    }
    let error;
    let text;
    try {
      // decipher text
      const decipher = crypto.createCipheriv(algorithm, key, iv);
      text = decipher.update(encrypted, 'utf8');
      text += decipher.final();
    } catch (decipherError) {
      error = new Error('Failed to decrypt config properties. Stack Trace: ' + decipherError.stack);
    }
    callback(error, text);
  });
}

module.exports = {
  encrypt: encrypt,
  decrypt: decrypt
};
