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
   * Do not allow removal of items that are in use
   */
  Icon.beforeRemote('deleteById', function (context, modelInstance, next) {
    app.models.referenceData
      .count({
        iconId: context.args.id
      })
      .then(function (count) {
        if (count) {
          throw app.utils.apiError.getError('MODEL_IN_USE', {model: Icon.modelName, id: context.args.id});
        }
        // store the instance that's about to be deleted to remove the resource from the disk later
        return Icon.findById(context.args.id)
          .then(function (icon) {
            if (icon) {
              context._deletedIcon = icon.toJSON();
            }
            next();
          });
      })
      .catch(next);
  });

  /**
   * After an icon is deleted, also remove the resource from disk
   */
  Icon.afterRemote('deleteById', function (context, modelInstance, next) {
    if (context._deletedIcon) {
      Icon.removeFromDisk(context._deletedIcon.path)
        .catch(function (error) {
          // only log the error, fail silently as the DB entry was removed
          context.req.logger.error(error);
        });
    }
    // do not wait for disk resource removal to complete, it's irrelevant for this operation
    next();
  });

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
    app.utils.remote.helpers.parseMultipartRequest(req, ['name'], ['icon'], function (error, fields, files) {
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
  }
};
