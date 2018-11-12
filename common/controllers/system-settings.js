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
   * Create a PDF file containing PNG images coming from PNG files
   * @param image Image content
   * @param splitFactor Split the image into:
   * - a nxm matrix computed based on the provided image size
   * - a square matrix with a side of <splitFactor> (1 no split, 2 => 2x2 grid, 3 => 3x3 grid) when splitType is grid
   * - a list of <splitFactor> images, divided horizontally when splitType is horizontal
   * - a list of <splitFactor> images, divided vertically when splitType is vertical
   * @param splitType enum: ['auto', grid', 'horizontal', 'vertical']. Default 'auto'.
   * @param callback
   */
  SystemSettings.createPdfFromImage = function (image, splitFactor, splitType, callback) {
    app.utils.helpers.createImageDoc(image, splitFactor, splitType, function (error, pdfDoc) {
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
          backUp: path.resolve(_.get(systemSettings, 'dataBackup.location'))
        });
      })
      .catch(callback);
  };

  /**
   * Generate a JSON or a QR-Code (PNG) file that encodes a JSON
   * @param type
   * @param data Data to be encoded
   * @param callback
   */
  SystemSettings.generateFile = function (type, data, callback) {
    // be more permissive on capitalisation
    type = type.toLowerCase();
    // handle each type individually
    switch (type) {
      case 'json':
        app.utils.remote.helpers
          .offerFileToDownload(JSON.stringify(data), 'application/json', `${uuid.v4()}.json`, callback);
        break;
      case 'qr':
        app.utils.remote.helpers
          .offerFileToDownload(app.utils.qrCode.encodeDataInQr(data), 'image/png', `${uuid.v4()}.png`, callback);
        break;
      default:
        // send error for invalid types
        callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {errorMessages: `Invalid File Type: ${type}. Supported options: json, qr`}));
        break;
    }
  };
};
