'use strict';

const app = require('../../server/server');
const tmp = require('tmp');
const path = require('path');
const fs = require('fs');
const apiError = require('../../components/apiError');

module.exports = function (ExportLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(ExportLog, [
    'create',
    'deleteById',
    'prototype.patchAttributes'
  ]);

  /**
   * Download exported files if I'm allowed to do so
   */
  ExportLog.prototype.downloadExportedFile = function (options, callback) {
    // get user information from request options
    const contextUser = app.utils.remote.getUserFromOptions(options);

    // authorized ?
    if (
      !contextUser.id ||
      this.createdBy !== contextUser.id
    ) {
      return callback(new Error('Not authorized'));
    }

    // file path
    const filePath = path.resolve(tmp.tmpdir, `${this.id}.${this.extension}`);

    // throw error if file doesn't exist
    if (!fs.existsSync(filePath)) {
      return callback(apiError.getError('FILE_NOT_FOUND'));
    }

    // prepare for file reading
    const fileStream = fs.createReadStream(filePath);

    // This catches any errors that happen while creating the readable stream (usually invalid names)
    fileStream.on('error', function () {
      callback(apiError.getError('FILE_NOT_FOUND'));
    });

    // remove after download
    fileStream.on('end', () => {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        // nothing
      }
    });

    // download file
    app.utils.remote.helpers.offerFileToDownload(
      fileStream,
      'application/octet-stream',
      `Case List.${this.extension}`,
      callback
    );
  };
};
