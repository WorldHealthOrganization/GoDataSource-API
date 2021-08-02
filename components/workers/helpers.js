'use strict';

const helpers = require('../helpers');
const exportHelper = require('../exportHelper');
const fileCrypto = require('../fileCrypto');
const aesCrypto = require('../aesCrypto');
const pdfDoc = require('../pdfDoc');

const worker = {
  /**
   * Export a list in a file (asynchronously)
   * @param headers file list headers
   * @param dataSet {Array} actual data set
   * @param fileType {enum} [json, csv, xls, xlsx, ods, pdf]
   * @return {Promise<any>}
   */
  exportListFile: helpers.exportListFileSync,
  /**
   * Encrypt file (AES-256) using password
   * @param password
   * @param options
   * @param filePath
   * @return {Promise<any>}
   */
  encryptFile: fileCrypto.encryptSync,
  /**
   * Decrypt file (AES-256) using password
   * @param password
   * @param options
   * @param filePath
   * @return {Promise<any>}
   */
  decryptFile: fileCrypto.decryptSync,
  /**
   * Encrypts data
   * @param password
   * @param data
   * @return {Promise<any>}
   */
  encrypt: aesCrypto.encrypt,
  /**
   * Decrypts data
   * @param password
   * @param data
   * @return {Promise<any>}
   */
  decrypt: aesCrypto.decrypt,
  /**
   * Create a PDF file containing PNG images
   * @param imageData
   * @param splitFactor Split the image into:
   * - a nxm matrix computed based on the provided image size
   * - a square matrix with a side of <splitFactor> (1 no split, 2 => 2x2 grid, 3 => 3x3 grid) when splitType is grid
   * - a list of <splitFactor> images, divided horizontally when splitType is horizontal
   * - a list of <splitFactor> images, divided vertically when splitType is vertical
   * @param splitType enum: ['auto', grid', 'horizontal', 'vertical']. Default 'auto'.
   * @param callback
   */
  createImageDoc: function (imageData, splitFactor, splitType) {
    return new Promise(function (resolve, reject) {
      // transform data back to buffer
      if (
        imageData &&
        imageData.data &&
        imageData.type === 'Buffer') {
        imageData = Buffer.from(imageData.data);
      }
      pdfDoc.createImageDoc(imageData, splitFactor, splitType, function (error, result) {
        if (error) {
          return reject(error);
        }
        return resolve(result);
      });
    });
  },
  /**
   * Export a filtered list of models
   */
  exportFilteredModelsList: exportHelper.exportFilteredModelsList
};

process.on('message', function (message) {
  // background worker ?
  if (message.backgroundWorker) {
    // trigger worker
    worker[message.fn](
      (error, result) => {
        // an error occurred ?
        if (error) {
          // send error to parent
          process.send([error instanceof Error ? {
            message: error.message,
            stack: error.stack
          } : error]);

          // finished
          return;
        }

        // trigger worker job
        process.send([null, result]);
      },
      ...message.args
    );
  } else {
    worker[message.fn](...message.args)
      .then(function (result) {
        process.send([null, result]);
      })
      .catch(function (error) {
        process.send([error instanceof Error ? {
          message: error.message,
          stack: error.stack
        } : error]);
      });
  }
});
