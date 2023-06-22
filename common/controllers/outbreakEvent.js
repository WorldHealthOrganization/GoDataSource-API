'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with event related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');
const WorkerRunner = require('./../../components/workerRunner');
const _ = require('lodash');
const Platform = require('../../components/platform');
const Config = require('../../server/config.json');
const importableFile = require('./../../components/importableFile');
const exportHelper = require('../../components/exportHelper');

// used in event import
const eventImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (Outbreak) {

  /**
   * Attach before remote (GET outbreaks/{id}/events) hooks
   */
  Outbreak.beforeRemote('prototype.findEvents', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context);
    // Enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  /**
   * Find outbreak events
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.findEvents = function (filter, options, callback) {
    filter = filter || {};
    filter.where = filter.where || {};

    filter.where = {
      and: [
        filter.where, {
          outbreakId: this.id
        }
      ]
    };

    // add geographical restriction to filter if needed
    app.models.event
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        updatedFilter && (filter.where = updatedFilter);

        return app.models.event
          .find(filter);
      })
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/events/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountEvents', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};

    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  /**
   * Allows count requests with advanced filters (like the ones we can use on GET requests)
   * to be mode on outbreak/{id}/events.
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountEvents = function (filter, options, callback) {
    // set default filter value
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // check if deep count should be used (this is expensive, should be avoided if possible)
    if (app.utils.remote.searchByRelationProperty.shouldUseDeepCount(filter)) {
      this.findEvents(filter, options, function (err, res) {
        if (err) {
          return callback(err);
        }
        callback(null, app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(res, filter).length);
      });
    } else {
      // add geographical restriction to filter if needed
      return app.models.event
        .addGeographicalRestrictions(options.remotingContext, filter.where)
        .then(updatedFilter => {
          updatedFilter && (filter.where = updatedFilter);

          return app.models.event.rawCountDocuments(filter);
        });
    }
  };

  /**
   * Attach before remote (GET outbreaks/{id}/events/export) hooks
   */
  Outbreak.beforeRemote('prototype.exportFilteredEvents', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};

    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  /**
   * Export filtered events to file
   * @param filter Supports MongoDB compatible queries
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredEvents = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

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

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // add geographical restriction to filter if needed
    app.models.event
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // updated filter
        updatedFilter && (filter.where = updatedFilter);

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'person',
            modelName: app.models.event.modelName,
            scopeQuery: app.models.event.definition.settings.scope,
            excludeBaseProperties: app.models.event.definition.settings.excludeBaseProperties,
            arrayProps: app.models.event.arrayProps,
            fieldLabelsMap: app.models.event.fieldLabelsMap,
            exportFieldsGroup: app.models.event.exportFieldsGroup,
            exportFieldsOrder: app.models.event.exportFieldsOrder,
            locationFields: app.models.event.locationFields,

            // fields that we need to bring from db, but we might not include in the export (you can still include it since we need it on import)
            // - responsibleUserId might be included since it is used on import, otherwise we won't have the ability to map this field
            projection: [
              'responsibleUserId'
            ]
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get(options, 'accessToken.userId'),
            outbreakId: this.id,
            questionnaire: undefined,
            useQuestionVariable: false,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          undefined, {
            responsibleUser: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'user',
              project: [
                '_id',
                'firstName',
                'lastName'
              ],
              key: '_id',
              keyValue: `(item) => {
                return item && item.responsibleUserId ?
                  item.responsibleUserId :
                  undefined;
              }`
            }
          }
        );
      })
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
   * Import an importable events file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableEventsFileUsingMap = function (body, options, callback) {
    const self = this;

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
      return genericHelpers.fillGeoLocationInformation(batchData, 'save.address', app)
        .then(() => {
          // build a list of create operations for this batch
          const createEvents = [];

          // go through all batch entries
          batchData.forEach(function (eventData) {
            createEvents.push(function (asyncCallback) {
              // sync the event
              return app.utils.dbSync.syncRecord(app, logger, app.models.event, eventData.save, options)
                .then(function () {
                  asyncCallback();
                })
                .catch(function (error) {
                  asyncCallback(null, {
                    success: false,
                    error: {
                      error: error,
                      data: {
                        file: eventData.raw,
                        save: eventData.save
                      }
                    }
                  });
                });
            });
          });

          return createEvents;
        });
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.event,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.event,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'event',
      batchSize: eventImportBatchSize,
      outbreakId: self.id,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.event.modelName,
      outbreakId: self.id,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };

  /**
   * Retrieve available people for a case
   * @param eventId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getEventRelationshipsAvailablePeople = function (eventId, filter, options, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        eventId,
        filter,
        options
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for an event
   * @param eventId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipsAvailablePeople = function (eventId, filter, options, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        eventId,
        filter,
        options
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };
};
