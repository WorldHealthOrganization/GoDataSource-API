'use strict';

const app = require('../../server/server');
const async = require('async');
const importableFileHelpers = require('./../../components/importableFile');
const WorkerRunner = require('./../../components/workerRunner');
const _ = require('lodash');

module.exports = function (ReferenceData) {

  /**
   * Expose available categories via API
   * @param callback
   */
  ReferenceData.getAvailableCategories = function (callback) {
    callback(null, ReferenceData.availableCategories);
  };

  /**
   * Export filtered reference data to a file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param options
   * @param callback
   */
  ReferenceData.exportFilteredReferenceData = function (filter, exportType, options, callback) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // export
    WorkerRunner.helpers.exportFilteredModelsList(
      {
        collectionName: 'referenceData',
        modelName: app.models.referenceData.modelName,
        scopeQuery: app.models.referenceData.definition.settings.scope,
        arrayProps: undefined,
        fieldLabelsMap: app.models.referenceData.fieldLabelsMap,
        exportFieldsGroup: undefined,
        exportFieldsOrder: undefined,
        locationFields: undefined
      },
      filter,
      exportType,
      undefined,
      undefined,
      undefined,
      {
        userId: _.get(options, 'accessToken.userId'),
        outbreakId: this.id,
        questionnaire: undefined,
        useQuestionVariable: false,
        useDbColumns,
        dontTranslateValues,
        jsonReplaceUndefinedWithNull,
        contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
      }
    )
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
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
    importableFileHelpers
      .getTemporaryFileById(body.fileId)
      .then(file => {
        // get file content
        const rawReferenceDataList = file.data;
        // remap properties & values
        const referenceDataList = app.utils.helpers.convertBooleanProperties(
          ReferenceData,
          app.utils.helpers.remapProperties(rawReferenceDataList, body.map, body.valuesMap));
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
                  recordNo: index + 1,
                  data: {
                    file: rawReferenceDataList[index],
                    save: referenceDataItem
                  }
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
      })
      .catch(callback);
  };
};
