'use strict';

const fork = require('child_process').fork;
const workersPath = `${__dirname}/../components/workers`;

/**
 * Invoke worker method
 * @param workerName
 * @param method
 * @param args
 * @param backgroundWorker
 * @param callback
 */
function invokeWorkerMethod(
  workerName,
  method,
  args,
  backgroundWorker,
  callback
) {
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
    cb = function noOp() {};
  }

  // fork the worker
  const worker = fork(`${workersPath}/${workerName}`, [], {
    execArgv: [],
    windowsHide: true
  });

  // invoke it
  worker.send({
    fn: method,
    backgroundWorker,
    args
  });

  // wait for it's response and process it
  worker.on('message', function (args) {
    // did we get an error ?
    if (args[0]) {
      // kill worker if not dead already
      try {
        worker.kill();
      } catch (e) {
        // nothing
      }

      // send error down the road to be processed
      return next(args[0]);
    }

    // should this worker continue in background until it finishes ?
    if (
      args[1] &&
      args[1].subject === 'WAIT'
    ) {
      // send response back to listener parent
      next(null, args[1].response);
    } else if (
        args[1] &&
        args[1].subject === 'KILL'
      ) {
      // kill worker since his job is done
      worker.kill();
    } else {
      // send response back to listener parent
      next(null, args[1]);

      // kill worker since his job is done
      worker.kill();
    }
  });

  // in case of failure, stop with error
  ['close', 'disconnect', 'error', 'exit'].forEach(function (event) {
    worker.on(event, function () {
      next(new Error(`Processing failed. Worker stopped. Event: ${event}, details: ${JSON.stringify(arguments)}`));
    });
  });
}

/**
 * Invoke worker method
 * @param {string} workerName - name of the file to be executed
 * @param {string} method - name of the method to be executed from file
 * @param {Object} options - Options
 * @param {function} actionOnMessage - Function to be executed anytime a message is received from child process
 * @returns {{sendMessageToWorker: sendMessageToWorker, stopWorker: stopWorker}}
 */
function startWorkerWithCommunication(workerName, method, options, actionOnMessage) {
  // fork the worker
  const worker = fork(`${workersPath}/${workerName}`, [], {
    execArgv: [],
    windowsHide: true
  });

  let workerStopped = false;

  // wait for its response and process it
  worker.on('message', function (args) {
    if (args[0]) {
      actionOnMessage(args[0]);
      // stop worker on error
      worker.kill();
      workerStopped = true;
      return;
    }
    actionOnMessage(null, args[1]);
  });

  // in case of failure, stop with error
  ['close', 'disconnect', 'error', 'exit'].forEach(function (event) {
    worker.on(event, function () {
      workerStopped = true;
      actionOnMessage(new Error(`Processing failed. Worker stopped. Event: ${event}, details: ${JSON.stringify(arguments)}`));
    });
  });

  // start worker functionality
  worker.send({
    fn: method,
    communication: true,
    options: options
  });

  return {
    sendMessageToWorker: (message) => {
      worker.send(message);
    },
    stopWorker: () => {
      if (!workerStopped) {
        workerStopped = true;
        worker.kill();
      }
    }
  };
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
      invokeWorkerMethod('transmissionChain', 'build', [relationships, followUpPeriod, options], false, callback);
    },
    /**
     * Count transmission chains
     * @param relationships
     * @param followUpPeriod
     * @param options {{activeChainStartDate: Date}}
     * @param callback
     */
    count: function (relationships, followUpPeriod, options, callback) {
      invokeWorkerMethod('transmissionChain', 'count', [relationships, followUpPeriod, options], false, callback);
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
      invokeWorkerMethod('personDuplicate', 'find', [people, filter], false, callback);
    },
    /**
     * Count the groups of duplicate people
     * @param people
     * @param callback
     */
    count: function (people, callback) {
      invokeWorkerMethod('personDuplicate', 'count', [people], false, callback);
    }
  },
  cases: {
    /**
     * Count cases stratified by classification over time
     * @param cases
     * @param periodInterval
     * @param periodType
     * @param weekType
     * @param periodMap
     * @param caseClassifications
     * @param callback
     */
    countStratifiedByClassificationOverTime: function (cases, periodInterval, periodType, weekType, periodMap, caseClassifications, callback) {
      invokeWorkerMethod(
        'cases',
        'countStratifiedByClassificationOverTime',
        [
          cases,
          periodInterval,
          periodType,
          weekType,
          periodMap,
          caseClassifications
        ],
        false,
        callback
      );
    },
    /**
     * Count cases stratified by outcome over time
     * @param cases
     * @param periodInterval
     * @param periodType
     * @param weekType
     * @param periodMap
     * @param caseOutcomeList
     * @param callback
     */
    countStratifiedByOutcomeOverTime: function (cases, periodInterval, periodType, weekType, periodMap, caseOutcomeList, callback) {
      invokeWorkerMethod(
        'cases',
        'countStratifiedByOutcomeOverTime',
        [
          cases,
          periodInterval,
          periodType,
          weekType,
          periodMap,
          caseOutcomeList
        ],
        false,
        callback
      );
    },
    /**
     * Count cases stratified by classification over reporting time
     * @param cases
     * @param periodInterval
     * @param periodType
     * @param weekType
     * @param periodMap
     * @param caseClassifications
     * @param callback
     */
    countStratifiedByClassificationOverReportingTime: function (cases, periodInterval, periodType, weekType, periodMap, caseClassifications, callback) {
      invokeWorkerMethod(
        'cases',
        'countStratifiedByClassificationOverReportingTime',
        [
          cases,
          periodInterval,
          periodType,
          weekType,
          periodMap,
          caseClassifications
        ],
        false,
        callback
      );
    }
  },
  sync: {
    /**
     * Export collections and create ZIP file
     * @param collections
     * @param options
     * @returns {Promise<any>}
     */
    exportCollections: function (collections, options) {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('sync', 'exportCollections', [collections, options], false, function (error, result) {
          if (error) {
            return reject(error);
          }
          resolve(result);
        });
      });
    },
    /**
     * Extract and Decrypt Snapshot archive
     * @param snapshotFile
     * @param options
     * @returns {Promise<any>}
     */
    extractAndDecryptSnapshotArchive: function (snapshotFile, options) {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('sync', 'extractAndDecryptSnapshotArchive', [snapshotFile, options], false, function (error, result) {
          if (error) {
            return reject(error);
          }
          resolve(result);
        });
      });
    }
  },
  helpers: {
    /**
     * Export a list in a file
     * @param headers file list headers
     * @param dataSet {Array} actual data set
     * @param fileType {enum} [json, csv, xls, xlsx, ods, pdf]
     * @return {Promise<any>}
     */
    exportListFile: function (headers, dataSet, fileType, title = 'List') {
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'exportListFile', [headers, dataSet, fileType, title], false, function (error, result) {
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
        invokeWorkerMethod('helpers', 'encryptFile', [password, options, filePath], false, function (error, result) {
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
        invokeWorkerMethod('helpers', 'decryptFile', [password, options, filePath], false, function (error, result) {
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
        invokeWorkerMethod('helpers', 'encrypt', [password, data], false, function (error, result) {
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
        invokeWorkerMethod('helpers', 'decrypt', [password, data], false, function (error, result) {
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
    exportFilteredModelsList: function () {
      // get method arguments
      const originalArguments = arguments;

      // our worker will work in background
      // trigger worker
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('helpers', 'exportFilteredModelsList', [...originalArguments], true, function (error, result) {
          // an error occurred ?
          if (error) {
            return reject(error);
          }

          // send export log id further
          resolve(result);
        });
      });
    }
  },
  importableFile: {
    upload: function () {
      let originalArguments = arguments;
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('importableFile', 'upload', [...originalArguments], false, function (error, result) {
          if (error) {
            return reject(error);
          }

          resolve(result);
        });
      });
    },
    getDistinctValuesForHeaders: function () {
      let originalArguments = arguments;
      return new Promise(function (resolve, reject) {
        invokeWorkerMethod('importableFile', 'getDistinctValuesForHeaders', [...originalArguments], false, function (error, result) {
          if (error) {
            return reject(error);
          }

          resolve(result);
        });
      });
    },
    /**
     * Import data from importable file given using given map
     * @param {Object} options - Options
     * @param {Function} actionOnMessage - Action to be executed on message from worker
     */
    importImportableFileUsingMap: function (options, actionOnMessage) {
      return startWorkerWithCommunication(
        'importableFile',
        'readAndFormatDataFromImportableFile',
        options,
        actionOnMessage
      );
    }
  },
  getContactFollowUpReport: function (
    outbreakId,
    startDate,
    endDate,
    whereFilter
  ) {
    return new Promise(function (resolve, reject) {
      invokeWorkerMethod('contactFollowUpReport', 'get', [outbreakId, startDate, endDate, whereFilter], false, (error, result) => {
        if (error) {
          return reject(error);
        }
        return resolve(result);
      });
    });
  }
};
