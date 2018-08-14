'use strict';

const app = require('../../server/server');
const uuid = require('uuid');
const moment = require('moment');

module.exports = function (SystemSettings) {

  app.utils.remote.disableRemoteMethods(SystemSettings, [
    'create',
    'findById',
    'deleteById',
    'prototype.patchAttributes',
    'count',
    'find'
  ]);

  /**
   * Retrieve System Settings
   * @param cb
   */
  SystemSettings.getSystemSettings = function (cb) {
    // There is only one entry in the system settings collection; get it
    SystemSettings.findOne()
      .then(function (instance) {
        if (instance) {
          cb(null, instance);
        } else {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: 'System settings are not initialized'
          });
        }
      })
      .catch(cb);
  };

  /**
   * Modify System Settings
   * @param data
   * @param options
   * @param cb
   */
  SystemSettings.updateSystemSettings = function (data, options, cb) {
    // There is only one entry in the system settings collection; get it and update it
    SystemSettings.findOne()
      .then(function (instance) {
        if (instance) {
          return instance.updateAttributes(data, options)
            .then(function (instance) {
              cb(null, instance);
            });
        } else {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: 'System settings are not initialized'
          });
        }
      })
      .catch(cb);
  };

  /**
   * Generate a globally unique id
   * @param callback
   */
  SystemSettings.generateUniqueId = function (callback) {
    return callback(null, {
      uuid: uuid.v4()
    });
  };

  /**
   * Create a PDF file containing PNG images coming from SVG/PNG files
   * @param image Image content
   * @param imageType Image type (PNG, SVG)
   * @param splitFactor Split the image into a square matrix with a side of splitFactor (1 no split, 2 => 2x2 grid, 3 => 3x3 grid)
   * @param callback
   */
  SystemSettings.createPdfFromImage = function (image, imageType, splitFactor, callback) {
    imageType = imageType.toUpperCase();

    // make sure we have a good image type
    if (!SystemSettings.imageTypes.hasOwnProperty(imageType)) {
      return callback(
        app.utils.apiError.getError('INVALID_IMAGE_TYPE', { imageType: imageType })
      );
    }

    app.utils.pdfDoc.createImageDoc(image, imageType, splitFactor, function (error, pdfDoc) {
      if (error) {
        return callback(error);
      }
      app.utils.remote.helpers.offerFileToDownload(pdfDoc, 'application/pdf', `${uuid.v4()}.pdf`, callback);
    });
  };

  /**
   * Generate current UTC date of the server
   * @param callback
   */
  SystemSettings.getServerUTCDate = function (callback) {
    return callback(
      null,
      {
        date: moment.utc()
      }
    );
  };
};
