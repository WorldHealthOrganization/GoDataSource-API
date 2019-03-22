'use strict';

const app = require('../../server/server');
const uuid = require('uuid');
const moment = require('moment');
const request = require('request');
const packageJson = require('../../package');
const config = require('../../server/config');
const _ = require('lodash');
const path = require('path');
const fork = require('child_process').fork;
const jimp = require('jimp');
const async = require('async');

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
    /**
     * Flow control, make sure callback is not called multiple times
     * @param err
     * @param result
     */
    const responseCallback = function (err, result) {
      // execute callback
      callback(err, result);
      // replace callback with no-op to prevent calling it multiple times
      callback = () => {};
    };

    // start the PDF builder worker
    const worker = fork(`${__dirname}../../../components/workers/createImageDoc`,
      [], {
        execArgv: [],
        windowsHide: true
      }
    );

    // error, exit listener
    const shutdownListener = function () {
      const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
      response.req.logger.error(JSON.stringify(error));
      return responseCallback(error);
    };

    // listen to exit events
    ['error', 'exit'].forEach(function (event) {
      worker.on(event, shutdownListener);
    });

    // listen to worker messages
    // this listener is mainly use for piping data into response, closing the response or killing the worker
    // to not be confused with listener attached when adding a new image into pdf
    // that listener is being removed and re-added for each image to refresh the context
    worker.on('message', function (args) {
      // first argument is an error
      if (args[0]) {
        return responseCallback(args[0]);
      }
      // if the message is a chunk
      if (args[1] && args[1].chunk) {
        // write it on the response
        response.write(Buffer.from(args[1].chunk.data));
      }
      // if the worker finished
      if (args[1] && args[1].end) {
        // end the response
        response.end();
        // process will be closed gracefully, remove listeners
        ['error', 'exit'].forEach(function (event) {
          worker.removeListener(event, shutdownListener);
        });
        // kill the worker
        worker.kill();
      }
    });

    // set appropriate headers
    response.set('Content-type', 'application/pdf');
    response.set('Content-disposition', `attachment;filename=${uuid.v4()}.pdf`);

    // define supported split types
    const splitTypes = {
      horizontal: 'horizontal',
      vertical: 'vertical',
      grid: 'grid',
      auto: 'auto'
    };

    // make sure the split type is one of the supported ones
    splitType = splitTypes[splitType];
    // default split type is auto
    if (!splitType) {
      splitType = splitTypes.auto;
    }

    // A3 page - margins
    const pageSize = {
      width: 1190,
      height: 840
    };

    // convert image base64 encoded string to buffer
    // to be parsed by Jimp lib
    const buffer = Buffer.from(imageBase64Str, 'base64');
    jimp
      .read(buffer)
      .then((image) => {
        if (!image) {
          return callback(new Error('Unknown image format.'));
        }

        // compute image aspect ratio
        const imageAspectRatio = image.bitmap.width / image.bitmap.height;
        const pageAspectRatio = pageSize.width / pageSize.height;

        // resize image to fill the page based on aspect ratio
        if (imageAspectRatio > pageAspectRatio) {
          image.resize(jimp.AUTO, pageSize.height * splitFactor);
        } else {
          image.resize(pageSize.width * splitFactor, jimp.AUTO);
        }

        // compute width, height, rows and columns
        let width, height, rows, columns;

        // for split type auto, decide automatically how many pages to create
        if (splitType === splitTypes.auto) {
          // compute how many columns and rows are needed based on image dimensions
          columns = Math.ceil(image.bitmap.width / pageSize.width);
          rows = Math.ceil(image.bitmap.height / pageSize.height);
          // the width and height match page dimension
          width = pageSize.width;
          height = pageSize.height;
        } else {
          // decide image height and number of rows based on split type
          if ([splitTypes.grid, splitTypes.vertical].includes(splitType)) {
            height = image.bitmap.height / splitFactor;
            rows = splitFactor;
          } else {
            height = image.bitmap.height;
            rows = 1;
          }

          // decide image width and number of columns based on split type
          if ([splitTypes.grid, splitTypes.horizontal].includes(splitType)) {
            width = image.bitmap.width / splitFactor;
            columns = splitFactor;
          } else {
            width = image.bitmap.width;
            columns = 1;
          }
        }

        // list of async functions to be passed to worker
        const asyncFns = [];

        // build a matrix of images, each cropped to its own position in the matrix
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            let processedHeight = row * height;
            let processedWidth = column * width;
            // calculate crop size and position
            let cropWidth = Math.min(Math.max(0, image.bitmap.width - processedWidth), width);
            let cropHeight = Math.min(Math.max(0, image.bitmap.height - processedHeight), height);
            // if something was cropped, add it to the list of images
            if (cropWidth && cropHeight) {
              asyncFns.push((cb) => {
                // clone the original image
                image
                  .clone((err, clonedImage) => {
                    if (err) {
                      return cb(err);
                    }
                    // crop it
                    clonedImage.crop(
                      processedWidth,
                      processedHeight,
                      cropWidth,
                      cropHeight,
                      (err, croppedImage) => {
                        if (err) {
                          return cb(err);
                        }

                        // convert it to base64, to be able to pass it to worker
                        croppedImage.getBuffer(jimp.MIME_PNG, (err, buffer) => {
                          if (err) {
                            return cb(err);
                          }
                          const base64 = buffer.toString('base64');

                          // force GC to cleanup the context early
                          // otherwise the closure will contain big objects
                          buffer = null;
                          clonedImage = null;
                          croppedImage = null;

                          // pass it to worker and wait until it is ready for next image
                          worker.send({
                            fn: 'addImage',
                            args: [{ base64: base64 }]
                          });

                          // worker communicates via messages, listen to them
                          const listener = function (args) {
                            // first argument is an error
                            if (args[0]) {
                              return cb(args[0]);
                            }
                            // if the worker is ready to receive data, continue with next async op
                            if (args[1] && args[1].ready) {
                              // remove current listener
                              worker.removeListener('message', listener);
                              // continue
                              return cb();
                            }
                          };

                          // listen to worker messages
                          worker.on('message', listener);
                        });
                      }
                    );
                  });
              });
            }
          }
        }

        // add cropped images one by one
        async.series(asyncFns, (err) => {
          if (err) {
            return callback(err);
          }
          // inform the worker that is time to finish
          worker.send({ fn: 'finish', args: [] });
        });
      })
      .catch(callback);
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
