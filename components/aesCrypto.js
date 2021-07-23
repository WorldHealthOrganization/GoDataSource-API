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
 * @return {Promise<any>}
 */
function encrypt(password, data) {
  // promisify the result
  return new Promise(function (resolve, reject) {
    // prepare encryption key & IV
    createKeyIv(password, function (err, key) {
      if (err) {
        return reject(err);
      }

      // convert data back to buffer which was lost while serialization ( main app => worker )
      if (
        data &&
        data instanceof Object &&
        data.data &&
        data.type === 'Buffer'
      ) {
        data = Buffer.from(data.data);
      }

      // encipher data
      const cipher = crypto.createCipheriv(algorithm, key.key, key.iv);
      const result = Buffer.concat([key.iv, key.salt, cipher.update(data), cipher.final()]);
      resolve(result);
    });
  });
}

/**
 * Decrypts data
 * @param password
 * @param data
 * @return {Promise<any>}
 */
function decrypt(password, data) {
  // promisify the result
  return new Promise(function (resolve, reject) {
    // buffer data
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
        return reject(err);
      }
      let error;
      let buffer;
      try {
        // decipher text
        const decipher = crypto.createCipheriv(algorithm, key, iv);
        buffer = Buffer.concat([decipher.update(encrypted) , decipher.final()]);
      } catch (decipherError) {
        error = new Error('Failed to decrypt config properties. Stack Trace: ' + decipherError.stack);
      }
      if (error) {
        return reject(error);
      }
      resolve(buffer);
    });
  });
}

/**
 * Encrypt stream
 */
const encryptStream = (
  readableStream,
  writableStream,
  password
) => {
  return new Promise(function (resolve, reject) {
    // prepare encryption key & IV
    createKeyIv(password, function (err, key) {
      // an error occurred ?
      if (err) {
        return reject(err);
      }

      // encipher data
      const cipher = crypto.createCipheriv(algorithm, key.key, key.iv);

      // write key data
      writableStream.write(key.iv);
      writableStream.write(key.salt);

      // start encrypting
      readableStream.on('data', (data) => {
        const encrypted = cipher.update(data);
        if (encrypted) {
          writableStream.write(encrypted);
        }
      });

      // finished writing
      readableStream.on('close', function() {
        // finalize encryption
        writableStream.write(cipher.final());

        // finished with temporary file used for encryption
        writableStream.close();

        // finished
        resolve();
      });
    });
  });
};

module.exports = {
  encrypt: encrypt,
  decrypt: decrypt,
  encryptStream
};
