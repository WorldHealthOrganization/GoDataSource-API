'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with lab-result related actions
 */

const app = require('../../server/server');
const WorkerRunner = require('./../../components/workerRunner');
const _ = require('lodash');
const exportHelper = require('./../../components/exportHelper');

module.exports = function (Outbreak) {
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
      .then(function (followUps) {
        callback(null, followUps);
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
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
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

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // prefilter
    app.models.contact.preFilterForOutbreak(this, filter, options)
      .then((filter) => {

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'labResult',
            modelName: app.models.labResult.modelName,
            scopeQuery: app.models.labResult.definition.settings.scope,
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
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          undefined,
          {
            person: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'person',
              project: [
                '_id',
                'visualId',
                'type',
                'lastName',
                'firstName',
                'middleName',
                'dateOfOnset',
                'dateOfReporting',
                'addresses'
              ],
              key: '_id',
              keyValue: `(labResult) => {
                return labResult && labResult.personId ?
                  labResult.personId :
                  undefined;
              }`,
              applyToAll: `(
                person,
                helperMethods
              ) => {
                // finished
                const addresses = person.addresses;
                delete person.addresses;

                // get only the current address
                if (
                  addresses &&
                  addresses.length > 0
                ) {
                  for (let addressIndex = 0; addressIndex < addresses.length; addressIndex++) {
                    const address = addresses[addressIndex];
                    if (
                      address &&
                      address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE'
                    ) {
                      // set address
                      person.address = address;

                      // transform geo location
                      helperMethods.covertAddressesGeoPointToLoopbackFormat(person);

                      // do we need to retrieve location ?
                      if (person.address.locationId) {
                        helperMethods.retrieveLocation(person.address.locationId);
                      }

                      // finished
                      break;
                    }
                  }
                }
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
   * Export filtered case lab results to file
   * @param caseId
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
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
    Outbreak.prototype.exportFilteredLabResults(
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
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
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
    Outbreak.prototype.exportFilteredLabResults(
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
    app.models.labResult.helpers.importImportableLabResultsFileUsingMap(this.id, body, app.models.case, options, callback);
  };

  /**
   * Import an importable lab results file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactLabResultsFileUsingMap = function (body, options, callback) {
    app.models.labResult.helpers.importImportableLabResultsFileUsingMap(this.id, body, app.models.contact, options, callback);
  };
};
