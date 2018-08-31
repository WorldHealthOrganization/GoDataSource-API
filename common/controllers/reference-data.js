'use strict';

const app = require('../../server/server');
const async = require('async');

module.exports = function (ReferenceData) {

  /**
   * Before update reference data hook
   */
  ReferenceData.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // if its not editable, it will send an error to the callback
    ReferenceData.isEntryEditable(context.instance, function (error) {
      // if the error says the instance is not editable
      if (error && ['MODEL_NOT_EDITABLE', 'MODEL_IN_USE'].indexOf(error.code) !== -1) {
        // and if data was sent
        if (context.args.data) {
          // allow customizing some safe properties
          const customizableProperties = ['iconId', 'colorCode'];

          // if model is editable but in use, also let it change the 'active' field
          if (error.code === 'MODEL_IN_USE') {
            customizableProperties.push('active');
          }

          const data = {};
          // exclude all unsafe properties from request
          Object.keys(context.args.data).forEach(function (property) {
            if (customizableProperties.indexOf(property) !== -1) {
              data[property] = context.args.data[property];
            }
          });
          context.args.data = data;
        }
      } else if (error) {
        // unhandled error
        return next(error);
      }
      next();
    });
  });

  /**
   * Expose available categories via API
   * @param callback
   */
  ReferenceData.getAvailableCategories = function (callback) {
    callback(null, ReferenceData.availableCategories);
  };

  /**
   * Get usage for a reference data entry
   * @param filter
   * @param callback
   */
  ReferenceData.prototype.getUsage = function (filter, callback) {
    ReferenceData.findModelUsage(this.id, filter, false, callback);
  };

  /**
   * Count usage for a reference data entry
   * @param where
   * @param callback
   */
  ReferenceData.prototype.countUsage = function (where, callback) {
    ReferenceData.findModelUsage(this.id, {where: where}, true, function (error, results) {
      if (error) {
        return callback(error);
      }
      callback(null,
        // count all of the results
        Object.values(results).reduce(function (a, b) {
          return a + b;
        }));
    });
  };

  /**
   * Restore a deleted reference data
   * @param id
   * @param options
   * @param callback
   */
  ReferenceData.restore = function (id, options, callback) {
    ReferenceData
      .findOne({
        deleted: true,
        where: {
          id: id,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: ReferenceData.modelName,
            id: id
          });
        }

        // undo reference data delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Export filtered reference data to a file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param options
   * @param callback
   */
  ReferenceData.exportFilteredReferenceData = function (filter, exportType, options, callback) {
    app.utils.remote.helpers.exportFilteredModelsList(app, app.models.referenceData, filter, exportType, 'Reference Data', null, [], options, null, function (results) {
      // translate category, value and description fields
      return new Promise(function (resolve, reject) {
        // load context user
        const contextUser = app.utils.remote.getUserFromOptions(options);
        // load user language dictionary
        app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
          // handle errors
          if (error) {
            return reject(error);
          }
          // go through all results
          results.forEach(function (result) {
            // translate category, value and description
            result.categoryId = dictionary.getTranslation(result.categoryId);
            result.value = dictionary.getTranslation(result.value);
            result.description = dictionary.getTranslation(result.description);
          });
          resolve(results);
        });
      });
    }, callback);
  };

  /**
   * Import an importable reference data file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  ReferenceData.importImportableReferenceDataFileUsingMap = function (body, options, callback) {
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawReferenceDataList = JSON.parse(file);
          // remap properties & values
          const referenceDataList = app.utils.helpers.remapProperties(rawReferenceDataList, body.map, body.valuesMap);
          // build a list of sync operations
          const syncReferenceData = [];
          // define a container for error results
          const syncErrors = [];
          // define a toString function to be used by error handler
          syncErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          referenceDataList.forEach(function (referenceDataItem, index) {
            syncReferenceData.push(function (callback) {
              // sync reference data
              return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.referenceData, referenceDataItem, options)
                .then(function (syncResult) {
                  callback(null, syncResult.record);
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  syncErrors.push({
                    message: `Failed to import reference data ${index + 1}`,
                    error: error,
                    recordNo: index + 1
                  });
                  callback(null, null);
                });
            });
          });
          // start importing reference data
          async.parallelLimit(syncReferenceData, 10, function (error, results) {
            // handle errors (should not be any)
            if (error) {
              return callback(error);
            }
            // if import errors were found
            if (syncErrors.length) {
              // remove results that failed to be added
              results = results.filter(result => result !== null);
              // define a toString function to be used by error handler
              results.toString = function () {
                return JSON.stringify(this);
              };
              // return error with partial success
              return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                model: app.models.referenceData.modelName,
                failed: syncErrors,
                success: results
              }));
            }
            // send the result
            callback(null, results);
          });
        } catch (error) {
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };
};
