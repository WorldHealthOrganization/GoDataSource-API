'use strict';

const formidable = require('formidable');
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
          return next(app.utils.apiError.getError('MODEL_IN_USE', {model: Icon.modelName, id: context.args.id}));
        }
        next();
      })
      .catch(next);
  });

  /**
   * Create (upload) a new icon
   * @param req
   * @param name
   * @param icon
   * @param callback
   */
  Icon.upload = function (req, name, icon, callback) {
    const form = new formidable.IncomingForm();
    form.parse(req, function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // validate required properties, loopback can't validate multi-part payloads
      let missingProperties = [];
      if (!fields.name) {
        missingProperties.push('name');
      }
      if (!files.icon) {
        missingProperties.push('icon');
      }
      // if there are missing required properties
      if (missingProperties.length) {
        // send back the error
        return callback(app.utils.apiError.getError('MISSING_REQUIRED_PROPERTY', {
          model: Icon.modelName,
          properties: missingProperties.join(', ')
        }));
      }
      // save resource on disk
      Icon.saveOnDisk(files.icon.path)
        .then(function (savePath) {
          // then save the record into database
          return Icon.create({
            name: fields.name,
            path: savePath
          });
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
        callback(null, imageBuffer, `image/${extension}`, `attachment;filename=${self.name}.${extension}`);
      })
      .catch(callback);
  }
};
