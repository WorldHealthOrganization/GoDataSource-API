'use strict';

const app = require('../../server/server');
const uuid = require('uuid');
const moment = require('moment');
const request = require('request');
const packageJson = require('../../package');
const config = require('../../server/config');
const _ = require('lodash');
const path = require('path');

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
        app.utils.apiError.getError('INVALID_IMAGE_TYPE', {imageType: imageType})
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

  /**
   * Check if the application has available updates
   * @param callback
   */
  SystemSettings.checkForUpdates = function (callback) {
    // build a base bath for the requests
    const basePath = `${config.updatesServer.protocol}://${config.updatesServer.host}:${config.updatesServer.port}/api/applications`;
    // query updates server for updates
    request({
      uri: `${basePath}/check-for-updates`,
      qs: {
        platform: packageJson.build.platform,
        type: packageJson.build.type,
        version: packageJson.version
      },
      json: true
    }, function (error, response, body) {
      // handle communication errors
      if (error) {
        return callback(app.utils.apiError.getError('EXTERNAL_API_CONNECTION_ERROR', {
          serviceName: 'Go.Data Version Manager',
          error: error
        }));
      }
      // handle invalid response errors
      if (response.statusCode !== 200) {
        return callback(app.utils.apiError.getError('UNEXPECTED_EXTERNAL_API_RESPONSE', {
          serviceName: 'Go.Data Version Manager',
          statusCode: response.statusCode,
          response: body
        }));
      }
      // assume no update available
      let application = {
        update: false
      };
      // if the response contains an update
      if (body && body.id) {
        // add update information to the response
        application = {
          update: true,
          name: body.name,
          description: body.description,
          version: body.version,
          platform: body.platform,
          download: `${basePath}/${body.id}/download`
        };
      }
      callback(null, application);
    });
  };

  /**
   * Expose build information via API
   * @param callback
   */
  SystemSettings.getVersion = function (callback) {
    callback(null, app.utils.helpers.getBuildInformation());
  };

  /**
   * Get system install and backup location
   * @param callback
   */
  SystemSettings.getBackupLocation = function (callback) {
    SystemSettings
      .getCache()
      .then(function (systemSettings) {
        callback(null, {
          install: app.ROOT_PATH,
          'back-up': path.resolve(_.get(systemSettings, 'dataBackup.location'))
        });
      })
      .catch(callback);
  };
};
