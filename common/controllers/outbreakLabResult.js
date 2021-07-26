'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with lab-result related actions
 */

const app = require('../../server/server');

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
    const self = this;

    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useQuestionVariable query param
    let useQuestionVariable = false, useDbColumns = false, dontTranslateValues = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // update filter for outbreak and geographical restriction
    app.models.labResult.preFilterForOutbreak(this, filter, options)
      .then(updatedFilter => {
        filter = updatedFilter;

        return new Promise((resolve, reject) => {
          const contextUser = app.utils.remote.getUserFromOptions(options);
          app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
            if (err) {
              return reject(err);
            }
            return resolve(dictionary);
          });
        });
      })
      .then(dictionary => {
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        // retrieve lab results with person data
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          false,
          (err, results) => {
            if (err) {
              return callback(err);
            }

            options.questionnaire = self.labResultsTemplate;
            options.dictionary = dictionary;
            options.useQuestionVariable = useQuestionVariable;

            // need to export only the usual place of residence for the person
            results.forEach((labResult) => {
              !labResult.person && (labResult.person = {});
              labResult.person.address = (labResult.person.addresses || []).find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE') || {};
              delete labResult.person.addresses;
            });

            options.records = results;

            app.utils.remote.helpers.exportFilteredModelsList(
              app,
              app.models.labResult,
              {},
              filter,
              exportType,
              'LabResult-List',
              encryptPassword,
              anonymizeFields,
              fieldsGroupList,
              options,
              null,
              callback
            );
          });
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
    const self = this;

    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // only case lab results
    filter.where.personId = caseId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';

    // parse useQuestionVariable query param
    let useQuestionVariable = false, useDbColumns = false, dontTranslateValues = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    new Promise((resolve, reject) => {
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
        if (err) {
          return reject(err);
        }
        return resolve(dictionary);
      });
    })
      .then(dictionary => {
        return app.models.labResult.preFilterForOutbreak(this, filter, options)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(data => {
        const dictionary = data.dictionary;
        const filter = data.filter;

        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        // retrieve lab results with person data
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          false,
          (err, results) => {
            if (err) {
              return callback(err);
            }

            options.questionnaire = self.labResultsTemplate;
            options.dictionary = dictionary;
            options.useQuestionVariable = useQuestionVariable;

            // need to export only the usual place of residence for the person
            results.forEach((labResult) => {
              !labResult.person && (labResult.person = {});
              labResult.person.address = (labResult.person.addresses || []).find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE') || {};
              delete labResult.person.addresses;
            });

            options.records = results;

            app.utils.remote.helpers.exportFilteredModelsList(
              app,
              app.models.labResult,
              {},
              filter,
              exportType,
              'LabResult-List',
              encryptPassword,
              anonymizeFields,
              fieldsGroupList,
              options,
              null,
              callback
            );
          });
      })
      .catch(callback);
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
    const self = this;

    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // only contact lab results
    filter.where.personId = contactId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';

    // parse useQuestionVariable query param
    let useQuestionVariable = false, useDbColumns = false, dontTranslateValues = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    new Promise((resolve, reject) => {
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
        if (err) {
          return reject(err);
        }
        return resolve(dictionary);
      });
    })
      .then(dictionary => {
        return app.models.labResult.preFilterForOutbreak(this, filter, options)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(data => {
        const dictionary = data.dictionary;
        const filter = data.filter;

        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        // retrieve lab results with person data
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          false,
          (err, results) => {
            if (err) {
              return callback(err);
            }

            options.questionnaire = self.labResultsTemplate;
            options.dictionary = dictionary;
            options.useQuestionVariable = useQuestionVariable;

            // need to export only the usual place of residence for the person
            results.forEach((labResult) => {
              !labResult.person && (labResult.person = {});
              labResult.person.address = (labResult.person.addresses || []).find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE') || {};
              delete labResult.person.addresses;
            });

            options.records = results;

            app.utils.remote.helpers.exportFilteredModelsList(
              app,
              app.models.labResult,
              {},
              filter,
              exportType,
              'LabResult-List',
              encryptPassword,
              anonymizeFields,
              fieldsGroupList,
              options,
              null,
              callback
            );
          });
      })
      .catch(callback);
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
