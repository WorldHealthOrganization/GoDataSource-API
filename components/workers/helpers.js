'use strict';

const helpers = require('../helpers');
const fileCrypto = require('../fileCrypto');

const worker = {
  /**
   * Export a list in a file (asynchronously)
   * @param headers file list headers
   * @param dataSet {Array} actual data set
   * @param fileType {enum} [json, xml, csv, xls, xlsx, ods, pdf]
   * @return {Promise<any>}
   */
  exportListFile: helpers.exportListFileSync,
  /**
   * Encrypt file (AES-256) using password
   * @param password
   * @param filePath
   * @return {Promise<any>}
   */
  encryptFile: fileCrypto.encryptSync,
  /**
   * Decrypt file (AES-256) using password
   * @param password
   * @param filePath
   * @return {Promise<any>}
   */
  decryptFile: fileCrypto.decryptSync
};

process.on('message', function (message) {
  worker[message.fn](...message.args)
    .then(function (result) {
      process.send([null, result]);
    })
    .catch(function (error) {
      process.send([error]);
    });
});
