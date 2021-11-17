'use strict';

const app = require('../../server/server');
const uuid = require('uuid');
const moment = require('moment');
const config = require('../../server/config');
const _ = require('lodash');
const path = require('path');
const fork = require('child_process').fork;

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
   * @param response Response object
   * @param imageBase64Str Image content
   * @param splitFactor Split the image into:
   * - a nxm matrix computed based on the provided image size
   * - a square matrix with a side of <splitFactor> (1 no split, 2 => 2x2 grid, 3 => 3x3 grid) when splitType is grid
   * - a list of <splitFactor> images, divided horizontally when splitType is horizontal
   * - a list of <splitFactor> images, divided vertically when splitType is vertical
   * @param splitType enum: ['auto', grid', 'horizontal', 'vertical']. Default 'auto'.
   * @param callback
   */
  SystemSettings.createPdfFromImage = function (response, imageBase64Str, splitFactor, splitType, callback) {
    // worker exit events
    const workerExitEvents = ['error', 'exit'];

    // start the PDF builder worker
    const worker = fork(`${__dirname}../../../components/workers/createImageDoc`,
      [], {
        // execArgv: [],
        execArgv: [`--inspect-brk=${Math.floor(Math.random() * 50000) + 10000}`],
        windowsHide: true
      }
    );

    // error, exit listener
    const shutdownListener = function () {
      const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
      response.req.logger.error(JSON.stringify(error));
      return callback(error);
    };

    // listen to worker's exit events
    workerExitEvents.forEach(function (event) {
      worker.on(event, shutdownListener);
    });

    // listen to worker messages
    // this listener is mainly use for piping data into response, closing the response or killing the worker
    // to not be confused with listener attached when adding a new image into pdf
    // that listener is being removed and re-added for each image to refresh the context
    worker.on('message', function (args) {
      // first argument is an error
      if (args[0]) {
        return callback(args[0]);
      }
      if (args[1]) {
        // send chunks to response
        if (args[1].chunk) {
          response.write(Buffer.from(args[1].chunk.data));
        }
        if (args[1].end) {
          // end the response
          response.end();
          // process will be closed gracefully, remove listeners
          ['error', 'exit'].forEach(function (event) {
            worker.removeListener(event, shutdownListener);
          });
          // kill the worker
          worker.kill();
        }
        // finished processing the images, notify the worker to close the document
        if (args[1].done) {
          worker.send({fn: 'finish', args: []});
        }
      }
    });

    // set appropriate headers
    response.set('Content-type', 'application/pdf');
    response.set('Content-disposition', `attachment;filename=${uuid.v4()}.pdf`);

    worker.send({
      fn: 'createImageDocument',
      args: [{
        imageBase64: imageBase64Str,
        splitType: splitType,
        splitFactor: splitFactor
      }]
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
   * Expose build information via API
   * @param callback
   */
  SystemSettings.getVersion = function (callback) {
    callback(
      null,
      Object.assign(
        {},
        app.utils.helpers.getBuildInformation(), {
          tokenTTL: config.authToken && config.authToken.ttl ?
            config.authToken.ttl :
            app.models.user.settings.ttl,
          skipOldPasswordForUserModify: config.skipOldPasswordForUserModify,
          captcha: app.utils.helpers.getCaptchaConfig(),
          demoInstance: config.demoInstance ?
            config.demoInstance : {
              enabled: false
            },
          duplicate: config.duplicate ?
            config.duplicate : {
              disableCaseDuplicateCheck: false,
              disableContactDuplicateCheck: false,
              disableContactOfContactDuplicateCheck: false,
              executeCheckOnlyOnDuplicateDataChange: false
            }
        }
      )
    );
  };

  /**
   * Get system install and backup location
   * @param callback
   */
  SystemSettings.getBackupLocation = function (callback) {
    SystemSettings
      .findOne()
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
