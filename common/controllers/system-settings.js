'use strict';

const app = require('../../server/server');
const uuid = require('uuid');
const config = require('../../server/config');
const _ = require('lodash');
const path = require('path');
const fork = require('child_process').fork;
const localizationHelper = require('../../components/localizationHelper');

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
        execArgv: [],
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
   * Expose build information via API
   * @param callback
   */
  SystemSettings.getVersion = function (callback) {
    callback(
      null,
      Object.assign(
        {},
        app.utils.helpers.getBuildInformation(), {
          timezone: localizationHelper.timezone,
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

  /**
   * Retrieve model definition
   */
  SystemSettings.getModelDefinition = function (model, callback) {
    // retrieve list of models
    const loopbackRegistry = app.registry ||
      app.loopback.registry ||
      app.loopback;
    const modelsMap = loopbackRegistry.modelBuilder.models;

    // construct model definition
    let modelData = modelsMap[model];

    // ignore map ?
    const modelsMapIgnore = {
      'Application': true,
      'ACL': true,
      'file': true
    };
    if (
      modelsMapIgnore[model] ||
      model.startsWith('AnonymousModel_')
    ) {
      modelData = undefined;
    }

    // data not found ?
    if (
      !modelData ||
      !modelData.definition ||
      !modelData.definition.rawProperties
    ) {
      return callback(app.utils.apiError.getError(
        'INTERNAL_ERROR', {
          error: `Invalid model type: ${model}. Supported options: ${Object.keys(modelsMap).filter((name) => !modelsMapIgnore[name] && !name.startsWith('AnonymousModel_')).join(', ')}`
        }
      ));
    }

    // type to def
    const typeToDefinition = (
      rawPropertyDefType
    ) => {
      // array ?
      if (
        Array.isArray(rawPropertyDefType) &&
        rawPropertyDefType.length > 0
      ) {
        // determine array item def type
        return [
          propertyToDefinition(
            rawPropertyDefType[0]
          )
        ];
      } else {
        // check if type is a model
        if (
          typeof rawPropertyDefType === 'string' &&
          modelsMap[rawPropertyDefType] &&
          modelsMap[rawPropertyDefType].definition &&
          modelsMap[rawPropertyDefType].definition.rawProperties
        ) {
          // go into object
          return modelToDefinition(
            modelsMap[rawPropertyDefType],
            rawPropertyDefType === 'address' ?
              Object.assign(
                {},
                modelsMap[rawPropertyDefType].definition.rawProperties, {
                  geoLocation: {
                    type: 'customGeoPoint'
                  }
                }
              ) :
              modelsMap[rawPropertyDefType].definition.rawProperties
          );
        } else if (
          typeof rawPropertyDefType === 'object'
        ) {
          // go into object
          return modelToDefinition(
            rawPropertyDefType,
            rawPropertyDefType
          );
        } else {
          if (
            rawPropertyDefType === 'string' ||
            rawPropertyDefType === 'number' ||
            rawPropertyDefType === 'boolean' ||
            rawPropertyDefType === 'object' ||
            rawPropertyDefType === 'date' ||
            rawPropertyDefType === 'any' ||
            rawPropertyDefType === 'file'
          ) {
            // add property
            return rawPropertyDefType;
          } else if (
            rawPropertyDefType === 'geopoint'
          ) {
            return modelToDefinition(
              modelsMap['customGeoPoint'],
              modelsMap['customGeoPoint'].definition.rawProperties
            );
          } else if (
            rawPropertyDefType === 'String'
          ) {
            return 'string';
          } else if (
            rawPropertyDefType === 'Date'
          ) {
            return 'date';
          } else if (
            rawPropertyDefType &&
            typeof rawPropertyDefType === 'function'
          ) {
            if (rawPropertyDefType.name) {
              if (rawPropertyDefType.name === 'Number') {
                return 'number';
              } else if (rawPropertyDefType.name === 'String') {
                return 'string';
              } else if (rawPropertyDefType.name === 'Date') {
                return 'date';
              } else if (rawPropertyDefType.name === 'Boolean') {
                return 'boolean';
              } else if (
                rawPropertyDefType.name &&
                modelsMap[rawPropertyDefType.name] &&
                modelsMap[rawPropertyDefType.name].definition &&
                modelsMap[rawPropertyDefType.name].definition.rawProperties
              ) {
                return modelToDefinition(
                  modelsMap[rawPropertyDefType.name],
                  rawPropertyDefType.name === 'address' ?
                    Object.assign(
                      {},
                      modelsMap[rawPropertyDefType.name].definition.rawProperties, {
                        geoLocation: {
                          type: 'customGeoPoint'
                        }
                      }
                    ) :
                    modelsMap[rawPropertyDefType.name].definition.rawProperties
                );
              } else {
                throw Error(`Error resolving function type with name '${rawPropertyDefType.name}' for model '${model}'`);
              }
            } else {
              throw Error(`Error resolving function type '${rawPropertyDefType}' for model '${model}'`);
            }
          } else {
            throw Error(`Error resolving type '${rawPropertyDefType}' for model '${model}'`);
          }
        }
      }
    };

    // add property definition
    const propertyToDefinition = (
      rawPropertyDef
    ) => {
      // take action depending of property type
      if (rawPropertyDef.type) {
        return typeToDefinition(
          rawPropertyDef.type
        );
      } else if (
        rawPropertyDef && (
          typeof rawPropertyDef === 'string' ||
          typeof rawPropertyDef === 'function' ||
          Array.isArray(rawPropertyDef)
        )
      ) {
        return typeToDefinition(
          rawPropertyDef
        );
      } else {
        throw Error(`Error resolving property '${rawPropertyDef}' for model '${model}'`);
      }
    };

    // construct definition
    const alreadyMapped = {};
    const modelToDefinition = (
      modelData,
      rawProperties
    ) => {
      // already mapped, then we need to return the map so we don't do a forever loop
      if (alreadyMapped[modelData]) {
        return alreadyMapped[modelData];
      }

      // save map
      const acc = {};
      alreadyMapped[modelData] = acc;

      // go through properties and map them
      Object.keys(rawProperties).forEach((rawProperty) => {
        // hidden property, then we need to exclude it
        if (
          modelData &&
          modelData.definition &&
          modelData.definition.settings &&
          modelData.definition.settings.hidden &&
          modelData.definition.settings.hidden.length > 0
        ) {
          if (modelData.definition.settings.hidden.indexOf(rawProperty) > -1) {
            // hide
            return;
          }
        }

        // map property
        acc[rawProperty] = propertyToDefinition(
          rawProperties[rawProperty]
        );
      });

      // finished
      return acc;
    };

    // start with root object
    const definition = modelToDefinition(
      modelData,
      modelData.definition.rawProperties
    );

    // clean recursive parents
    const cleanRecursive = (
      acc,
      paths
    ) => {
      Object.keys(acc).forEach((property) => {
        // get value
        const propValue = acc[property];

        // check if already mapped
        let objectIndex = 0;
        let alreadyMapped = false;
        while (objectIndex < paths.length) {
          // mapped ?
          if (
            paths[objectIndex] === propValue || (
              propValue &&
              Array.isArray(propValue) &&
              propValue.length > 0 &&
              paths[objectIndex] === propValue[0]
            )
          ) {
            // mapped
            alreadyMapped = true;

            // finished
            break;
          }

          // next
          objectIndex++;
        }

        // already mapped ?
        if (alreadyMapped) {
          delete acc[property];
        } else if (
          propValue &&
          Array.isArray(propValue) &&
          propValue.length > 0
        ) {
          if (typeof propValue[0] === 'object') {
            cleanRecursive(
              propValue[0], [
                ...paths,
                propValue[0]
              ]
            );
          }
        } else if (
          typeof propValue === 'object'
        ) {
          cleanRecursive(
            propValue, [
              ...paths,
              propValue
            ]
          );
        } else {
          // nothing, seems okay
        }
      });
    };
    cleanRecursive(
      definition,
      []
    );

    // finished
    callback(
      null,
      definition
    );
  };
};
