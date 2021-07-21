'use strict';

const app = require('../../server/server');
const tmp = require('tmp');
const path = require('path');
const fs = require('fs');

module.exports = function (ExportLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(ExportLog, [
    'create',
    'prototype.patchAttributes',
    'prototype.deleteById'
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
      throw new Error('Not authorized');
    }

    // read file content
    const filePath = path.resolve(tmp.tmpdir, this.id);
    const fileStream = fs.createReadStream(filePath);

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
