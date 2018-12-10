'use strict';

const fork = require('child_process').fork;
const workersPath = `${__dirname}/../components/workers`;

/**
 * Invoke worker method
 * @param workerName
 * @param method
 * @param args
 * @param callback
 */
function invokeWorkerMethod(workerName, method, args, callback) {
  // callback is the initial one
  let cb = callback;

  /**
   * Execute callback only once
   * @param error
   * @param result
   */
  function next(error, result) {
    // execute callback
    cb(error, result);
    // replace callback with no-op to prevent calling it multiple times
    cb = function noOp() {
    };
  }

  // fork the worker
  const worker = fork(`${workersPath}/${workerName}`, [], {
    execArgv: [],
    windowsHide: true
  });
  // invoke it
  worker.send({fn: method, args});
  // wait for it's response and process it
  worker.on('message', function (args) {
    if (args[0]) {
      return next(args[0]);
    }
    next(null, args[1]);
    worker.kill();
  });
  // in case of failure, stop with error
  ['close', 'disconnect', 'error', 'exit'].forEach(function (event) {
    worker.on(event, function () {
      next(new Error(`Processing failed. Worker stopped. Event: ${event}, details: ${JSON.stringify(arguments)}`));
    });
  });
}


module.exports = {
  transmissionChain: {
    /**
     * Build transmission chains
     * @param relationships
     * @param followUpPeriod
     * @param options {{activeChainStartDate: Date}}
     * @param callback
     */
    build: function (relationships, followUpPeriod, options, callback) {
      invokeWorkerMethod('transmissionChain', 'build', [relationships, followUpPeriod, options], callback);
    },
    /**
     * Count transmission chains
     * @param relationships
     * @param followUpPeriod
     * @param options {{activeChainStartDate: Date}}
     * @param callback
     */
    count: function (relationships, followUpPeriod, options, callback) {
      invokeWorkerMethod('transmissionChain', 'count', [relationships, followUpPeriod, options], callback);
    }
  },
  personDuplicate: {
    /**
     * Find groups of duplicate people
     * @param people
     * @param filter only used for paginating data (skip, limit)
     * @param callback
     */
    find: function (people, filter, callback) {
      invokeWorkerMethod('personDuplicate', 'find', [people, filter], callback);
    },
    /**
     * Count the groups of duplicate people
     * @param people
     * @param callback
     */
    count: function (people, callback) {
      invokeWorkerMethod('personDuplicate', 'count', [people], callback);
    }
  },
  cases: {
    /**
     * Count cases stratified by classification over time
     * @param cases
     * @param periodInterval
     * @param periodType
     * @param periodMap
     * @param caseClassifications
     * @param callback
     */
    countStratifiedByClassificationOverTime: function (cases, periodInterval, periodType, periodMap, caseClassifications, callback) {
      invokeWorkerMethod('cases', 'countStratifiedByClassificationOverTime', [cases, periodInterval, periodType, periodMap, caseClassifications], callback);
    }
  },
  sync: {
    /**
     * Export collections and create ZIP file
     * @param collections
     * @param options
     * @returns {Promise<any | never>}
     */
    exportCollections: function (collections, options, callback) {
      invokeWorkerMethod('sync', 'exportCollections', [collections, options], callback);
    }
  },
  helpers: {
    /**
     * Export a list in a file
     * @param headers file list headers
     * @param dataSet {Array} actual data set
     * @param fileType {enum} [json, xml, csv, xls, xlsx, ods, pdf]
     * @return {Promise<any>}
     */
    exportListFile: function (headers, dataSet, fileType, title = 'List') {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'exportListFile', [headers, dataSet, fileType, title], function (error, result) {
          if (error) {
            return reject(error);
          }
          // if data was buffer, transform it back to buffer
          if (
            result &&
            result.data &&
            result.data.type === 'Buffer') {
            result.data = Buffer.from(result.data.data);
          }
          resolve(result);
        });
      });
    },
    /**
     * Encrypt file (AES-256) using password
     * @param password
     * @param options
     * @param filePath
     * @return {Promise<any>}
     */
    encryptFile: function (password, options, filePath) {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'encryptFile', [password, options, filePath], function (error, result) {
          if (error) {
            return reject(error);
          }
          // if data was buffer, transform it back to buffer
          if (
            result &&
            result.data &&
            result.type === 'Buffer') {
            result = Buffer.from(result.data);
          }
          resolve(result);
        });
      });
    },
    /**
     * Decrypt file (AES-256) using password
     * @param password
     * @param options
     * @param filePath
     * @return {Promise<any>}
     */
    decryptFile: function (password, options, filePath) {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'decryptFile', [password, options, filePath], function (error, result) {
          if (error) {
            return reject(error);
          }
          // if data was buffer, transform it back to buffer
          if (
            result &&
            result.data &&
            result.type === 'Buffer') {
            result = Buffer.from(result.data);
          }
          resolve(result);
        });
      });
    },
    /**
     * Encrypts data
     * @param password
     * @param data
     * @return {Promise<any>}
     */
    encrypt: function (password, data) {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'encrypt', [password, data], function (error, result) {
          if (error) {
            return reject(error);
          }
          // if data was buffer, transform it back to buffer
          if (
            result &&
            result.data &&
            result.type === 'Buffer') {
            result = Buffer.from(result.data);
          }
          resolve(result);
        });
      });
    },
    /**
     * Decrypts data
     * @param password
     * @param data
     * @return {Promise<any>}
     */
    decrypt: function (password, data) {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'decrypt', [password, data], function (error, result) {
          if (error) {
            return reject(error);
          }
          // if data was buffer, transform it back to buffer
          if (
            result &&
            result.data &&
            result.type === 'Buffer') {
            result = Buffer.from(result.data);
          }
          resolve(result);
        });
      });
    },
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
    createImageDoc: function (imageData, splitFactor, splitType, callback) {
      invokeWorkerMethod('helpers', 'createImageDoc', [imageData, splitFactor, splitType], function (error, result) {
        if (error) {
          return callback(error);
        }
        // if data was buffer, transform it back to buffer
        if (
          result &&
          result.data &&
          result.type === 'Buffer') {
          result = Buffer.from(result.data);
        }
        callback(null, result);
      });
    }
  }
};
