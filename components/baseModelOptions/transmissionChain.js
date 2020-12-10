'use strict';

const path = require('path');
const fs = require('fs-extra');
const config = require('../../server/config.json');
const zlib = require('zlib');

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
      return `${cotInstanceId}.gzip`;
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
      // create promise
      return new Promise((resolve, reject) => {
        try {
          // stringify
          const cotString = JSON.stringify(cot);

          // gzip data
          zlib.gzip(
            cotString,
            (errGzip, buffer) => {
              // error ?
              if (errGzip) {
                return reject(errGzip);
              }

              // write data
              try {
                fs.writeFile(
                  this.getFilePath(cotInstance.id),
                  buffer,
                  (errWrite) => {
                    // error ?
                    if (errWrite) {
                      return reject(errWrite);
                    }

                    // success
                    resolve();
                  }
                );
              } catch (e2) {
                reject(e2);
              }
            }
          );
        } catch (e) {
          reject(e);
        }
      });
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
