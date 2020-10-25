'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

module.exports = function (ImportableFile) {

  // set flag to force using the controller
  ImportableFile.hasController = true;

  /**
   * Get file using file id
   * @param fileId
   * @param callback
   */
  ImportableFile.getTemporaryFileById = function (fileId, callback) {
    fs.readFile(path.join(os.tmpdir(), fileId), callback);
  };
};
