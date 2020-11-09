'use strict';

const importableFile = require('./../importableFile');

const worker = {
  /**
   * Upload an importable file
   */
  upload: importableFile.upload,
  /**
   * Get distinct values for headers
   */
  getDistinctValuesForHeaders: importableFile.getDistinctValuesForHeaders
};

process.on('message', function (message) {
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
});

