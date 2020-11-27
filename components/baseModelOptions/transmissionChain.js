'use strict';

const path = require('path');
const fs = require('fs-extra');
const config = require('../../server/config.json');

// calculate cot storage path
const storagePath = config.cot && config.cot.containerPath ?
  (
    // use configured path; if relative make it relative to config.json
    path.isAbsolute(config.cot.containerPath) ?
      path.resolve(config.cot.containerPath) :
      path.resolve(__dirname, '../../server', config.cot.containerPath)
  ) :
  // default
  path.resolve(__dirname, '../../server/storage/files');

module.exports = {
  storagePath: storagePath,

  helpers: {
    /**
     * Get COT filename given the instance ID
     * @param {string} cotInstanceId
     * @returns {string}
     */
    getFileName: function (cotInstanceId) {
      return `${cotInstanceId}.json`;
    },
    /**
     * Get COT file path given the instance ID
     * @param cotInstanceId
     * @returns {string}
     */
    getFilePath: function (cotInstanceId) {
      return path.resolve(storagePath, this.getFileName(cotInstanceId));
    },
    /**
     * Save COT file
     * @param {Object} cotInstance - Transmission chain instance
     * @param {Object} cot - calculated COT
     * @returns {*}
     */
    saveFile: function (cotInstance, cot) {
      return fs
        .writeJSON(this.getFilePath(cotInstance.id), cot);
    },
    /**
     * Get COT file contents
     * @param {Object} cotInstance - Transmission chain instance
     * @returns {*}
     */
    getFileContents: function (cotInstance) {
      return fs.createReadStream(this.getFilePath(cotInstance.id));
    }
  }
};
