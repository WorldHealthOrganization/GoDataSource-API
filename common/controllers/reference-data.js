'use strict';

const app = require('../../server/server');
const WorkerRunner = require('./../../components/workerRunner');
const Platform = require('../../components/platform');
const _ = require('lodash');
const importableFile = require('./../../components/importableFile');
const Config = require('../../server/config.json');
const genericHelpers = require('../../components/helpers');

// used in import
const referenceDataImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

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
        excludeBaseProperties: app.models.referenceData.definition.settings.excludeBaseProperties,
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
    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // treat the sync as a regular operation, not really a sync
    options._sync = false;

    // inject platform identifier
    options.platform = Platform.IMPORT;

    /**
     * Create array of actions that will be executed in series for each batch
     * Note: Failed items need to have success: false and any other data that needs to be saved on error needs to be added in a error container
     * @param {Array} batchData - Batch data
     * @returns {[]}
     */
    const createBatchActions = function (batchData) {
      // build a list of sync operations
      const syncReferenceData = [];

      // go through all entries
      batchData.forEach(function (referenceDataItem) {
        syncReferenceData.push(function (asyncCallback) {
          // sync reference data
          return app.utils.dbSync.syncRecord(app, logger, app.models.referenceData, referenceDataItem.save, options)
            .then(function () {
              asyncCallback();
            })
            .catch(function (error) {
              // on error, store the error, but don't stop, continue with other items
              asyncCallback(null, {
                success: false,
                error: {
                  error: error,
                  data: {
                    file: referenceDataItem.raw,
                    save: referenceDataItem.save
                  }
                }
              });
            });
        });
      });

      return syncReferenceData;
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.referenceData,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.referenceData,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'referenceData',
      batchSize: referenceDataImportBatchSize,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.referenceData.modelName,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };

  /**
   * Expose available categories per disease via API
   */
  ReferenceData.getAvailableCategoriesPerDisease = function (callback) {
    callback(null, ReferenceData.availableCategoriesPerDisease);
  };
};
