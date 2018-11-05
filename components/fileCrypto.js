'use strict';

/**
 * File encryption/decryption using AES-256 (aesCrypto)
 */

const aesCrypto = require('./aesCrypto');
const fs = require('fs');

/**
 * Encrypt file (AES-256) using password
 * @param password
 * @param filePath
 * @return {Promise<any>}
 */
function encryptSync(password, filePath) {
  // promisify the result
  return new Promise(function (resolve, reject) {
    // read the file
    fs.readFile(filePath, function (error, buffer) {
      // handle read errors
      if (error) {
        return reject(error);
      }
      // encrypt the file
      return aesCrypto
        .encrypt(password, buffer)
        .then(function (encryptedData) {
          // replace original file with encrypted one
          fs.writeFile(filePath, encryptedData, function (error) {
            if (error) {
              return reject(error);
            }
            resolve(filePath);
          });
        });
    });
  });
}

/**
 * Decrypt file (AES-256) using password
 * @param password
 * @param filePath
 * @return {Promise<any>}
 */
function decryptSync(password, filePath) {
  // promisify the result
  return new Promise(function (resolve, reject) {
    // read the file
    fs.readFile(filePath, function (error, buffer) {
      // handle read errors
      if (error) {
        return reject(error);
      }
      // decrypt the file
      return aesCrypto
        .decrypt(password, buffer)
        .then(function (decryptedData) {
          // replace original file with decrypted one
          fs.writeFile(filePath, decryptedData, function (error) {
            if (error) {
              return reject(error);
            }
            resolve(filePath);
          });
        });
    });
  });
}

module.exports = {
  encryptSync: encryptSync,
  decryptSync: decryptSync
};
