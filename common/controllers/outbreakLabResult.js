'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with lab-result related actions
 */

const app = require('../../server/server');
const WorkerRunner = require('./../../components/workerRunner');
const _ = require('lodash');
const exportHelper = require('./../../components/exportHelper');
const genericHelpers = require('../../components/helpers');
const Config = require('../../server/config.json');

module.exports = function (Outbreak) {
  /**
   * Bulk modify lab results
   * @param where
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkModifyLabResults = function (where, data, options, callback) {
    // since the query can return many results we will do the update in batches
    // Note: Updating each lab result one by one in order for the "before/after save" hooks to be executed for each entry
    // container for count
    let labResultsCount = 0;

    // initialize parameters for handleActionsInBatches call
    const getActionsCount = () => {
      return app.models.labResult
        .count(where)
        .then(count => {
          // cache count
          labResultsCount = count;

          return Promise.resolve(count);
        });
    };

    const getBatchData = (batchNo, batchSize) => {
      // get lab results for batch
      return app.models.labResult
        .find({
          where: where,
          skip: (batchNo - 1) * batchSize,
          limit: batchSize,
          order: 'createdAt ASC'
        });
    };

    const itemAction = (labResultRecord) => {
      return labResultRecord.updateAttributes(data, options);
    };

    genericHelpers.handleActionsInBatches(
      getActionsCount,
      getBatchData,
      null,
      itemAction,
      _.get(Config, 'jobSettings.bulkModifyLabResults.batchSize', 1000),
      10,
      options.remotingContext.req.logger
    )
      .then(() => {
        callback(null, {count: labResultsCount});
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/lab-results/aggregate) hooks
   */
  Outbreak.beforeRemote('prototype.findLabResultsAggregate', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak lab results along with case information
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.findLabResultsAggregate = function (filter, options, callback) {
    app.models.labResult
      .preFilterForOutbreak(this, filter, options)
      .then(filter => {
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          false,
          callback
        );
      });
  };

  /**
   * Attach before remote (GET outbreaks/{id}/lab-results/aggregate-filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountLabResultsAggregate', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });

  /**
   * Count outbreak lab-results
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountLabResultsAggregate = function (filter, options, callback) {
    app.models.labResult
      .preFilterForOutbreak(this, filter, options)
      .then(filter => {
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          true,
          callback
        );
      });
  };

  /**
   * Attach before remote (GET outbreaks/{id}/lab-results/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountLabResults', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });

  /**
   * Count outbreak lab-results
   * @param filter Supports 'where.case' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountLabResults = function (filter, options, callback) {
    // pre-filter using related data (case)
    app.models.labResult
      .preFilterForOutbreak(this, filter, options)
      .then(filter => {
        if (!this.isContactLabResultsActive) {
          filter.where.personType = {
            neq: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          };
        }
        // count using query
        return app.models.labResult.rawCountDocuments(filter);
      })
      .then(function (labResults) {
        callback(null, labResults);
      })
      .catch(callback);
  };

  /**
   * Count a case's lab-results
   * @param caseId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountCaseLabResults = function (caseId, filter, options, callback) {
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.personId = caseId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';

    app.models.labResult
      .preFilterForOutbreak(this, filter, options)
      .then(filter => {
        // handle custom filter options
        return app.models.labResult.rawCountDocuments(filter);
      })
      .then(result => callback(null, result))
      .catch(callback);
  };

  /**
   * Count a contact's lab-results
   * @param contactId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountContactLabResults = function (contactId, filter, options, callback) {
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.personId = contactId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';

    app.models.labResult
      .preFilterForOutbreak(this, filter, options)
      .then(filter => {
        // handle custom filter options
        return app.models.labResult.rawCountDocuments(filter);
      })
      .then(result => callback(null, result))
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/lab-results/export) hooks
   */
  Outbreak.beforeRemote('prototype.exportFilteredLabResults', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });

  /**
   * Export filtered lab results to file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredLabResults = function (
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

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

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

    // apply geo restrictions
    app.models.person
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where.person
      )
      .then((updatedFilter) => {
        // update where if needed
        updatedFilter && (filter.where.person = updatedFilter);

        // prefilters
        const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
          filter, {
            outbreakId: this.id
          }, {
            contact: {
              collection: 'person',
              queryPath: 'where.contact',
              queryAppend: {
                type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
              },
              localKey: 'personId',
              foreignKey: '_id'
            },
            case: {
              collection: 'person',
              queryPath: 'where.case',
              queryAppend: {
                type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
              },
              localKey: 'personId',
              foreignKey: '_id'
            },
            person: {
              collection: 'person',
              queryPath: 'where.person',
              localKey: 'personId',
              foreignKey: '_id'
            }
          }
        );

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'labResult',
            modelName: app.models.labResult.modelName,
            scopeQuery: app.models.labResult.definition.settings.scope,
            excludeBaseProperties: app.models.labResult.definition.settings.excludeBaseProperties,
            arrayProps: app.models.labResult.arrayProps,
            fieldLabelsMap: app.models.labResult.helpers.sanitizeFieldLabelsMapForExport(),
            exportFieldsGroup: app.models.labResult.exportFieldsGroup,
            exportFieldsOrder: app.models.labResult.exportFieldsOrder,
            locationFields: app.models.labResult.locationFields
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get(options, 'accessToken.userId'),
            outbreakId: this.id,
            questionnaire: this.labResultsTemplate ?
              this.labResultsTemplate.toJSON() :
              undefined,
            useQuestionVariable,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          prefilters,
          undefined,
          {
            person: {
              type: exportHelper.JOIN_TYPE.HAS_ONE,
              collection: 'person',
              localField: 'personId',
              foreignField: '_id',
              project: {
                visualId: '$$joinValue.visualId',
                type: '$$joinValue.type',
                lastName: '$$joinValue.lastName',
                firstName: '$$joinValue.firstName',
                middleName: '$$joinValue.middleName',
                dateOfOnset: '$$joinValue.dateOfOnset',
                dateOfReporting: '$$joinValue.dateOfReporting',
                address: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$$joinValue.addresses',
                        as: 'item',
                        cond: {
                          $eq: [
                            '$$item.typeId',
                            'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE'
                          ]
                        }
                      }
                    },
                    0
                  ]
                }
              }
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
   * Export filtered case lab results to file
   * @param caseId
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredCaseLabResults = function (
    caseId,
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // only case lab results
    filter.where.personId = caseId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';

    // trigger export
    Outbreak.prototype.exportFilteredLabResults.call(
      this,
      filter,
      exportType,
      encryptPassword,
      anonymizeFields,
      fieldsGroupList,
      options,
      callback
    );
  };

  /**
   * Export filtered case lab results to file
   * @param contactId
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContactLabResults = function (
    contactId,
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // only case lab results
    filter.where.personId = contactId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';

    // trigger export
    Outbreak.prototype.exportFilteredLabResults.call(
      this,
      filter,
      exportType,
      encryptPassword,
      anonymizeFields,
      fieldsGroupList,
      options,
      callback
    );
  };

  /**
   * Import an importable lab results file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableCaseLabResultsFileUsingMap = function (body, options, callback) {
    app.models.labResult.helpers.importImportableLabResultsFileUsingMap(this, body, app.models.case, options, callback);
  };

  /**
   * Import an importable lab results file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactLabResultsFileUsingMap = function (body, options, callback) {
    app.models.labResult.helpers.importImportableLabResultsFileUsingMap(this, body, app.models.contact, options, callback);
  };
};
