'use strict';

/**
 * File encryption/decryption using AES-256 (aesCrypto)
 */

const aesCrypto = require('./aesCrypto');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');

/**
 * Encrypt file (AES-256) using password
 * @param password
 * @param options {{keepOriginal: boolean}}
 * @param filePath
 * @return {Promise<any>}
 */
function encryptSync(password, options, filePath) {
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
          // if original file should be preserved
          if (options.keepOriginal) {
            // extract its extension
            const extension = path.extname(filePath);
            // define a new path for the file
            filePath = filePath.replace(extension, `-${uuid.v4()}${extension}`);
          }
          // write encrypted file
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
 * @param options {{keepOriginal: boolean}}
 * @param filePath
 * @return {Promise<any>}
 */
function decryptSync(password, options, filePath) {
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
          // if original file should be preserved
          if (options.keepOriginal) {
            // extract its extension
            const extension = path.extname(filePath);
            // define a new path for the file
            filePath = filePath.replace(extension, `-${uuid.v4()}${extension}`);
          }
          // write decrypted file
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
