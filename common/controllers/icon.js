'use strict';

const app = require('../../server/server');
const path = require('path');

module.exports = function (Icon) {

  // disable built-in create method, POST will be overwritten
  app.utils.remote.disableRemoteMethods(Icon, [
    'create',
    'prototype.patchAttributes'
  ]);

  /**
   * Create (upload) a new icon
   * @param req
   * @param name
   * @param icon
   * @param options
   * @param callback
   */
  Icon.upload = function (req, name, icon, options, callback) {
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, ['name'], ['icon'], Icon, [], function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // save resource on disk
      Icon.saveOnDisk(files.icon.path)
        .then(function (savePath) {
          // then save the record into database
          return Icon.create({
            name: fields.name,
            path: savePath
          }, options);
        })
        .then(function (image) {
          callback(null, image);
        })
        .catch(callback);
    });
  };

  /**
   * Download an icon
   * @param callback
   */
  Icon.prototype.download = function (callback) {
    const self = this;
    Icon.readFromDisk(this.path)
      .then(function (imageBuffer) {
        const extension = path.extname(self.path).replace('.', '');
        app.utils.remote.helpers
          .offerFileToDownload(imageBuffer, `image/${extension}`, `${self.name}.${extension}`, callback);
      })
      .catch(callback);
  };
};
