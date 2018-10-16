'use strict';

const app = require('../../server/server');
const path = require('path');

module.exports = function (FileAttachment) {

  /**
   * Create (upload) a new file
   * @param outbreakId
   * @param req
   * @param name
   * @param file
   * @param options
   * @param callback
   */
  FileAttachment.upload = function (outbreakId, req, name, file, options, callback) {
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, ['name'], ['file'], FileAttachment, function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // save resource on disk
      FileAttachment.saveOnDisk(files.file)
        .then(function (savePath) {
          // then save the record into database
          return FileAttachment.create({
            outbreakId: outbreakId,
            name: fields.name,
            originalName: files.file.name,
            mimeType: files.file.type,
            path: savePath
          }, options);
        })
        .then(function (file) {
          callback(null, file);
        })
        .catch(callback);
    });
  };

  /**
   * Download a file
   * @param callback
   */
  FileAttachment.prototype.download = function (callback) {
    const self = this;
    FileAttachment.readFromDisk(this.path)
      .then(function (fileBuffer) {
        const extension = path.extname(self.path);
        app.utils.remote.helpers
          .offerFileToDownload(fileBuffer, self.mimeType && self.mimeType.length ? self.mimeType : 'application/octet-stream', `${self.name}${extension}`, callback);
      })
      .catch(callback);
  };
};
