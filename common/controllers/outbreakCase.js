'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with case related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');
const WorkerRunner = require('./../../components/workerRunner');
const pdfUtils = app.utils.pdfDoc;
const _ = require('lodash');
const tmp = require('tmp');
const fs = require('fs');
const AdmZip = require('adm-zip');
const Config = require('../../server/config.json');
const Platform = require('../../components/platform');
const importableFile = require('./../../components/importableFile');
const apiError = require('../../components/apiError');
const exportHelper = require('./../../components/exportHelper');
const localizationHelper = require('../../components/localizationHelper');

// used in getCaseCountMap function
const caseCountMapBatchSize = _.get(Config, 'jobSettings.caseCountMap.batchSize', 10000);

// used in case import
const caseImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (Outbreak) {
  /**
   * Attach before remote hooks for GET outbreaks/{id}/cases/count
   */
  Outbreak.beforeRemote('prototype.__count__cases', function (context, modelInstance, next) {
    // add geographical restrictions if needed
    app.models.case
      .addGeographicalRestrictions(context, context.args.where)
      .then(updatedFilter => {
        // update where if needed
        updatedFilter && (context.args.where = updatedFilter);

        return next();
      })
      .catch(next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/cases/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountCases', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountCases', (context, modelInstance, next) => {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};

    Outbreak.helpers.findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Count outbreak cases
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountCases = function (filter, options, callback) {
    // pre-filter using related data (case)
    app.models.case
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // fix for some filter options received from web ( e.g $elemMatch search in array properties )
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // replace nested geo points filters
        app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.case,
          filter.where,
          true,
          undefined,
          true
        );

        // count using query
        return app.models.case.rawCountDocuments(filter);
      })
      .then(function (cases) {
        callback(null, cases);
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/cases) hooks
   */
  Outbreak.beforeRemote('prototype.findCases', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context);
    // enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation(
      context,
      modelInstance,
      next
    );
  });

  /**
   * Ensure backwards compatibility of the received filter
   */
  Outbreak.beforeRemote('prototype.findCases', (context, modelInstance, next) => {
    Outbreak.helpers.findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak cases
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.findCases = function (filter, options, callback) {
    // pre-filter using related data (case)
    app.models.case
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // fix for some filter options received from web ( e.g $elemMatch search in array properties )
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // replace nested geo points filters
        app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.case,
          filter.where,
          true
        );

        // find cases using filter
        return app.models.case.find(filter);
      })
      .then(function (cases) {
        callback(null, cases);
      })
      .catch(callback);
  };

  /**
   * Get bars cot data
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getBarsTransmissionChains = function (filter, options, callback) {
    app.models.person.getBarsTransmissionChainsData(this.id, filter, options, callback);
  };

  /**
   * Count cases stratified by classification over reporting time
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesStratifiedByClassificationOverReportingTime = function (filter, options, callback) {
    app.models.case.countStratifiedByClassificationOverReportingTime(this, filter, options)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count cases stratified by classification over time
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesStratifiedByClassificationOverTime = function (filter, options, callback) {
    app.models.case.countStratifiedByClassificationOverTime(this, filter, options)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count cases stratified by outcome over time
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesStratifiedByOutcomeOverTime = function (filter, options, callback) {
    app.models.case.countStratifiedByOutcomeOverTime(this, filter, options)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Get a list of entries that show the delay between date of symptom onset and the hospitalization/isolation dates for a case
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.caseDelayBetweenOnsetAndHospitalizationIsolation = function (filter, options, callback) {
    app.models.case
      .delayBetweenOnsetAndHospitalisationIsolation(this.id, filter, options)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Get a list of entries that show the delay between date of symptom onset and the lab testing for a case
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.caseDelayBetweenOnsetAndLabTesting = function (filter, options, callback) {
    app.models.case
      .delayBetweenOnsetAndLabTesting(this.id, filter, options)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/cases/per-classification/count) hooks
   */
  Outbreak.beforeRemote('prototype.countCasesPerClassification', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.countCasesPerClassification', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Count cases by case classification
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesPerClassification = function (filter, options, callback) {
    app.models.person
      .groupCount(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
        filter,
        'classification',
        'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_UNCLASSIFIED'
      )
      .then((result) => {
        callback(
          null,
          result
        );
      })
      .catch(callback);
  };

  /**
   * Count cases by case classification
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesHospitalized = function (filter, options, callback) {
    app.models.case
      .countCasesHospitalized(
        options,
        this.id,
        filter
      )
      .then((result) => {
        callback(
          null,
          result
        );
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/cases/export) hooks
   */
  Outbreak.beforeRemote('prototype.exportFilteredCases', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};

    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  Outbreak.beforeRemote('prototype.exportFilteredCases', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Export filtered cases to file
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredCases = function (
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

    // parse includeContactFields query param
    let includeContactFields = false;
    if (filter.where.hasOwnProperty('includeContactFields')) {
      includeContactFields = filter.where.includeContactFields;
      delete filter.where.includeContactFields;
    }

    // parse includeContactOfContactFields query param
    let includeContactOfContactFields = false;
    if (filter.where.hasOwnProperty('includeContactOfContactFields')) {
      includeContactOfContactFields = filter.where.includeContactOfContactFields;
      delete filter.where.includeContactOfContactFields;
    }

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

    // prefilters
    const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
      filter, {
        outbreakId: this.id
      }, {
        relationship: {
          collection: 'relationship',
          queryPath: 'where.relationship',
          localKey: '_id',
          foreignKey: 'persons[].id',
          foreignKeyArraySize: 2
        },
        labResult: {
          collection: 'labResult',
          queryPath: 'where.labResult',
          localKey: '_id',
          foreignKey: 'personId'
        }
      }
    );

    // do we need to include contact/contact of contact data in case exported data if case was a contact/contact of contact ?
    let additionalFieldsToExport;
    if (
      includeContactFields ||
      includeContactOfContactFields
    ) {
      // initialize additional fields to export
      additionalFieldsToExport = {
        fields: {},
        arrayProps: {},
        locationFields: []
      };

      // determine case fields
      const caseFields = {};
      _.each(
        app.models.case.fieldLabelsMap,
        (caseFieldToken, caseField) => {
          // should exclude or include ?
          let shouldExclude = false;
          if (app.models.case.definition.settings.excludeBaseProperties) {
            for (let index = 0; index < app.models.case.definition.settings.excludeBaseProperties.length; index++) {
              let excludedField = app.models.case.definition.settings.excludeBaseProperties[index];
              if (
                caseField === excludedField ||
                caseField.startsWith(`${excludedField}.`) ||
                caseField.startsWith(`${excludedField}[]`)
              ) {
                // must exclude field
                shouldExclude = true;

                // no need to check further
                break;
              }
            }
          }

          // should exclude or include field ?
          if (!shouldExclude) {
            caseFields[caseField] = caseFieldToken;
          }
        }
      );

      // include contact fields ?
      if (includeContactFields) {
        // determine contact fields
        const contactFields = {};
        _.each(
          app.models.contact.fieldLabelsMap,
          (contactFieldToken, contactField) => {
            // should exclude or include ?
            let shouldExclude = false;
            if (app.models.contact.definition.settings.excludeBaseProperties) {
              for (let index = 0; index < app.models.contact.definition.settings.excludeBaseProperties.length; index++) {
                let excludedField = app.models.contact.definition.settings.excludeBaseProperties[index];
                if (
                  contactField === excludedField ||
                  contactField.startsWith(`${excludedField}.`) ||
                  contactField.startsWith(`${excludedField}[]`)
                ) {
                  // must exclude field
                  shouldExclude = true;

                  // no need to check further
                  break;
                }
              }
            }

            // should exclude or include field ?
            if (!shouldExclude) {
              contactFields[contactField] = contactFieldToken;
            }
          }
        );

        // determine what fields from contact are missing from case
        _.each(
          contactFields,
          (contactFieldToken, contactField) => {
            if (!caseFields[contactField]) {
              // add field
              additionalFieldsToExport.fields[contactField] = contactFieldToken;

              // is array property ?
              if (app.models.contact.arrayProps[contactField]) {
                additionalFieldsToExport.arrayProps[contactField] = app.models.contact.arrayProps[contactField];
              }

              // is location property ?
              if (app.models.contact.locationFields.indexOf(contactField) > -1) {
                additionalFieldsToExport.locationFields.push(contactField);
              }
            }
          }
        );
      }

      // include contact of contact fields ?
      if (includeContactOfContactFields) {
        // determine contact of contact fields
        const contactOfContactFields = {};
        _.each(
          app.models.contactOfContact.fieldLabelsMap,
          (contactOfContactFieldToken, contactOfContactField) => {
            // should exclude or include ?
            let shouldExclude = false;
            if (app.models.contactOfContact.definition.settings.excludeBaseProperties) {
              for (let index = 0; index < app.models.contactOfContact.definition.settings.excludeBaseProperties.length; index++) {
                let excludedField = app.models.contactOfContact.definition.settings.excludeBaseProperties[index];
                if (
                  contactOfContactField === excludedField ||
                  contactOfContactField.startsWith(`${excludedField}.`) ||
                  contactOfContactField.startsWith(`${excludedField}[]`)
                ) {
                  // must exclude field
                  shouldExclude = true;

                  // no need to check further
                  break;
                }
              }
            }

            // should exclude or include field ?
            if (!shouldExclude) {
              contactOfContactFields[contactOfContactField] = contactOfContactFieldToken;
            }
          }
        );

        // determine what fields from contact are missing from case
        _.each(
          contactOfContactFields,
          (contactOfContactFieldToken, contactOfContactField) => {
            if (!caseFields[contactOfContactField]) {
              // add field
              additionalFieldsToExport.fields[contactOfContactField] = contactOfContactFieldToken;

              // is array property ?
              if (app.models.contactOfContact.arrayProps[contactOfContactField]) {
                additionalFieldsToExport.arrayProps[contactOfContactField] = app.models.contactOfContact.arrayProps[contactOfContactField];
              }

              // is location property ?
              if (app.models.contactOfContact.locationFields.indexOf(contactOfContactField) > -1) {
                additionalFieldsToExport.locationFields.push(contactOfContactField);
              }
            }
          }
        );
      }
    }

    // prefilter
    app.models.case
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then(updatedFilter => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'person',
            modelName: app.models.case.modelName,
            scopeQuery: app.models.case.definition.settings.scope,
            excludeBaseProperties: app.models.case.definition.settings.excludeBaseProperties,
            arrayProps: app.models.case.arrayProps,
            fieldLabelsMap: app.models.case.fieldLabelsMap,
            exportFieldsGroup: app.models.case.exportFieldsGroup,
            exportFieldsOrder: app.models.case.exportFieldsOrder,
            locationFields: app.models.case.locationFields,
            additionalFieldsToExport,

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
            questionnaire: this.caseInvestigationTemplate ?
              this.caseInvestigationTemplate.toJSON() :
              undefined,
            useQuestionVariable,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          prefilters, {
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
   * Count the new cases in the previous X days detected among known contacts
   * @param filter Besides the default filter properties this request also accepts 'noDaysAmongContacts': number on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.countNewCasesInThePreviousXDaysDetectedAmongKnownContacts = function (filter, options, callback) {
    // initialize noDaysAmongContacts filter
    let noDaysAmongContacts;
    // check if the noDaysAmongContacts filter was sent; accepting it only on the first level
    noDaysAmongContacts = _.get(filter, 'where.noDaysAmongContacts');
    if (typeof noDaysAmongContacts !== 'undefined') {
      // noDaysAmongContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysAmongContacts;
    } else {
      // get the outbreak noDaysAmongContacts as the default noDaysNewContacts value
      noDaysAmongContacts = this.noDaysAmongContacts;
    }

    // get from noDaysAmongContacts ago
    let xDaysAgo = new Date(localizationHelper.now().toDate().setHours(0, 0, 0, 0));
    xDaysAgo.setDate(localizationHelper.now().toDate().getDate() - noDaysAmongContacts);

    // get outbreakId
    let outbreakId = this.id;

    // normalize filter
    !filter && (filter = {});

    // add geographical restrictions if needed
    app.models.case
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // get all cases that were reported sooner or have 'dateBecomeCase' sooner than 'noDaysAmongContacts' ago
        return app.models.case
          .rawFind(app.utils.remote
            .mergeFilters({
              where: {
                outbreakId: outbreakId,
                or: [{
                  wasContact: true,
                  dateBecomeCase: {
                    gte: xDaysAgo
                  }
                }, {
                  dateOfReporting: {
                    gte: xDaysAgo
                  }
                }]
              }
            }, filter || {}).where
          );
      })
      .then(function (cases) {
        // initialize result
        let result = {
          newCasesCount: cases.length,
          newCasesAmongKnownContactsCount: 0,
          newCasesAmongKnownContactsIDs: []
        };

        // get the newCasesAmongKnownContactsIDs
        result.newCasesAmongKnownContactsIDs = cases.filter(item => item.wasContact && localizationHelper.toMoment(item.dateBecomeCase).toDate() >= xDaysAgo).map(item => item.id);
        result.newCasesAmongKnownContactsCount = result.newCasesAmongKnownContactsIDs.length;

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Returns a pdf list, containing the outbreak's cases, distributed by location and classification
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.downloadCaseClassificationPerLocationLevelReport = function (filter, options, callback) {
    const self = this;
    const languageId = options.remotingContext.req.authData.user.languageId;
    // Get the dictionary so we can translate the case classifications and other necessary fields
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      app.models.person.getPeoplePerLocation('case', filter, self, options)
        .then((result) => {
          // Get all existing case classification so we know how many rows the list will have
          return app.models.referenceData
            .find({
              where: {
                categoryId: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION'
              }
            })
            .then(classification => [classification, result]);
        })
        .then((result) => {
          let caseClassifications = result[0];
          let caseDistribution = result[1].peopleDistribution || [];
          const locationCorelationMap = result[1].locationCorelationMap || {};
          let headers = [];
          // Initialize data as an object to easily distribute cases per classification. This will be changed to an array later.
          let data = {};

          // Create the list headers. These contain 2 custom headers (case type and total number of cases),
          // and all the reporting level locations
          headers.push({
            id: 'type',
            header: dictionary.getTranslation('LNG_LIST_HEADER_CASE_CLASSIFICATION')
          });

          caseDistribution.forEach((dataObj) => {
            headers.push({
              id: dataObj.location.id,
              header: dataObj.location.name
            });
          });

          headers.push({
            id: 'total',
            header: dictionary.getTranslation('LNG_LIST_HEADER_TOTAL')
          });

          // Add all existing classifications to the data object
          // Keep the values as strings so that 0 actually gets displayed in the table
          caseClassifications.forEach((caseClassification) => {
            if (!app.models.case.invalidCaseClassificationsForReports.includes(caseClassification.value)) {
              data[caseClassification.value] = {
                type: dictionary.getTranslation(caseClassification.value),
                total: '0'
              };
            }
          });

          // Since deceased is not a classification but is relevant to the report, add it separately
          // Keep the values as strings so that 0 actually gets displayed in the table
          data.deceased = {
            type: dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED'),
            total: '0'
          };

          // Initialize all counts per location with 0 for each case classification (including deceased)
          // Keep the values as strings so that 0 actually gets displayed in the table
          Object.keys(data).forEach((key) => {
            caseDistribution.forEach((dataObj) => {
              data[key][dataObj.location.id] = '0';
            });
          });

          // Go through all the cases and increment the relevant case counts.
          caseDistribution.forEach((dataObj) => {
            dataObj.people.forEach((caseModel) => {
              // get case current address
              const caseCurrentAddress = app.models.person.getCurrentAddress(caseModel);
              // define case latest location
              let caseLatestLocation;
              // if the case has a current address
              if (caseCurrentAddress) {
                // get case current location
                caseLatestLocation = caseCurrentAddress.locationId;
              }
              if (caseModel.outcomeId === 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED') {
                // if the case has a current location and the location is a reporting location
                if (caseLatestLocation) {
                  if (data.deceased[locationCorelationMap[caseLatestLocation]]) {
                    data.deceased[locationCorelationMap[caseLatestLocation]] = (parseInt(data.deceased[locationCorelationMap[caseLatestLocation]]) + 1) + '';
                  }
                } else {
                  // missing location
                  data.deceased[app.models.location.noLocation.id] = (parseInt(data.deceased[app.models.location.noLocation.id]) + 1) + '';
                }

                // total
                data.deceased.total = (parseInt(data.deceased.total) + 1) + '';
              } else if (data[caseModel.classification]) {
                // if the case has a current location and the location is a reporting location
                if (caseLatestLocation) {
                  if (data[caseModel.classification][locationCorelationMap[caseLatestLocation]]) {
                    data[caseModel.classification][locationCorelationMap[caseLatestLocation]] = (parseInt(data[caseModel.classification][locationCorelationMap[caseLatestLocation]]) + 1) + '';
                  }
                } else {
                  // missing location
                  data[caseModel.classification][app.models.location.noLocation.id] = (parseInt(data[caseModel.classification][app.models.location.noLocation.id]) + 1) + '';
                }

                // total
                data[caseModel.classification].total = (parseInt(data[caseModel.classification].total) + 1) + '';
              }
            });
          });

          // Create the pdf list file
          return app.utils.helpers.exportListFile(headers, Object.values(data), 'pdf', 'Case distribution per location');
        })
        .then(function (file) {
          // and offer it for download
          app.utils.remote.helpers.offerFileToDownload(file.data, file.mimeType, `Case distribution per location.${file.extension}`, callback);
        })
        .catch(callback);
    });
  };

  /**
   * Count the cases per period per contact status
   * @param filter Besides the default filter properties this request also accepts
   * 'periodType': enum [day, week, month],
   * 'periodInterval':['date', 'date']
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesPerPeriodPerContactStatus = function (filter, options, callback) {
    // initialize periodType filter; default is day; accepting day/week/month
    let periodType;
    let periodTypes = {
      day: 'day',
      week: 'week',
      month: 'month'
    };

    // check if the periodType filter was sent; accepting it only on the first level
    periodType = _.get(filter, 'where.periodType');
    if (typeof periodType !== 'undefined') {
      // periodType was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodType;
    }

    // check if the received periodType is accepted
    if (Object.values(periodTypes).indexOf(periodType) === -1) {
      // set default periodType
      periodType = periodTypes.day;
    }

    // initialize periodInterval; keeping it as moment instances we need to use them further in the code
    let periodInterval;
    // check if the periodInterval filter was sent; accepting it only on the first level
    periodInterval = _.get(filter, 'where.periodInterval');
    if (typeof periodInterval !== 'undefined') {
      // periodInterval was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodInterval;

      // normalize periodInterval dates
      // let empty if start date is not provided
      if (periodInterval[0]) {
        periodInterval[0] = localizationHelper.getDateStartOfDay(periodInterval[0]).toISOString();
      }

      // and current date if end date is not provided
      periodInterval[1] = periodInterval[1] ?
        localizationHelper.getDateEndOfDay(periodInterval[1]).toISOString() :
        localizationHelper.getDateEndOfDay().toISOString();
    } else {
      // set default periodInterval depending on periodType
      periodInterval = genericHelpers.getPeriodIntervalForDate(undefined, periodType);
    }

    // create date condition
    let filterDate = {};

    // set the date condition
    if (
      periodInterval[0] &&
      periodInterval[1]
    ) {
      filterDate = {
        'gte': periodInterval[0],
        'lte': periodInterval[1]
      };
    } else {
      filterDate = {
        'lte': periodInterval[1]
      };
    }

    // get outbreakId
    let outbreakId = this.id;

    // initialize result
    let result = {
      totalCasesCount: 0,
      totalCasesNotFromContact: 0,
      totalCasesFromContactWithFollowupComplete: 0,
      totalCasesFromContactWithFollowupLostToFollowup: 0,
      caseIDs: [],
      caseNotFromContactIDs: [],
      caseFromContactWithFollowupCompleteIDs: [],
      caseFromContactWithFollowupLostToFollowupIDs: [],
      percentageOfCasesWithFollowupData: 0,
      period: []
    };

    // initialize default filter
    let defaultFilter = {
      where: {
        // cases only from our outbreak
        outbreakId: outbreakId,

        // exclude discarded cases
        classification: {
          nin: app.models.case.discardedCaseClassifications
        },

        // get only the cases reported in the periodInterval
        or: [
          {
            dateOfReporting: filterDate,
            dateBecomeCase: {
              eq: null
            }
          }, {
            dateBecomeCase: filterDate
          }
        ]
      },
      order: 'dateOfReporting ASC'
    };

    // initialize map for final followup status to properties that need to be updated in result
    const finalFollowupStatusMap = {
      'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_FOLLOW_UP_COMPLETED': {
        counter: 'totalCasesFromContactWithFollowupComplete',
        idContainer: 'caseFromContactWithFollowupCompleteIDs'
      },
      'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP': {
        counter: 'totalCasesFromContactWithFollowupComplete',
        idContainer: 'caseFromContactWithFollowupCompleteIDs'
      },
      'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP': {
        counter: 'totalCasesFromContactWithFollowupLostToFollowup',
        idContainer: 'caseFromContactWithFollowupLostToFollowupIDs'
      }
    };

    // normalize filter
    !filter && (filter = {});

    // add geographical restrictions if needed
    app.models.case
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // get all the cases for the filtered period
        return app.models.case
          .find(app.utils.remote
            .mergeFilters(defaultFilter, filter || {})
          );
      })
      .then(function (cases) {
        // set start date to first date of reporting if it's not set
        if (!periodInterval[0]) {
          periodInterval[0] = cases.length > 0 &&
          cases[0].dateOfReporting ?
            localizationHelper.getDateStartOfDay(cases[0].dateOfReporting).toISOString() :
            localizationHelper.getDateEndOfDay().toISOString();
        }

        // get periodMap for interval
        let periodMap = genericHelpers.getChunksForInterval(periodInterval, periodType);
        // fill additional details for each entry in the periodMap
        Object.keys(periodMap).forEach(function (entry) {
          Object.assign(periodMap[entry], {
            totalCasesCount: 0,
            totalCasesNotFromContact: 0,
            totalCasesFromContactWithFollowupComplete: 0,
            totalCasesFromContactWithFollowupLostToFollowup: 0,
            caseIDs: [],
            caseNotFromContactIDs: [],
            caseFromContactWithFollowupCompleteIDs: [],
            caseFromContactWithFollowupLostToFollowupIDs: [],
            percentageOfCasesWithFollowupData: 0
          });
        });

        cases.forEach(function (item) {
          // get case date; it's either dateBecomeCase or dateOfReporting
          let caseDate = item.dateBecomeCase || item.dateOfReporting;

          // get interval based on date of onset
          const casePeriodInterval = genericHelpers.getPeriodIntervalForDate(periodInterval, periodType, caseDate);

          // create a period identifier
          let casePeriodIdentifier = casePeriodInterval.join(' - ');

          // increase total case count counter and add case ID in container
          periodMap[casePeriodIdentifier].totalCasesCount++;
          periodMap[casePeriodIdentifier].caseIDs.push(item.id);
          result.totalCasesCount++;
          result.caseIDs.push(item.id);

          // check if case was converted from contact and increase required counters
          if (!item.dateBecomeCase) {
            // case was not converted from contact
            // increase period counters
            periodMap[casePeriodIdentifier].totalCasesNotFromContact++;
            periodMap[casePeriodIdentifier].caseNotFromContactIDs.push(item.id);

            // increase total counters
            result.totalCasesNotFromContact++;
            result.caseNotFromContactIDs.push(item.id);
          } else {
            // case was converted from a contact
            // get follow-up status
            let finalFollowupStatus = _.get(item, 'followUp.status', null);
            // get entry in finalFollowupStatusMap; the entry might not be found for unknown statuses
            let finalFollowupStatusEntry = finalFollowupStatusMap[finalFollowupStatus];

            // check if the final follow-up status is known; was found in map
            if (finalFollowupStatusEntry) {
              // increase period counter
              periodMap[casePeriodIdentifier][finalFollowupStatusEntry.counter]++;
              periodMap[casePeriodIdentifier][finalFollowupStatusEntry.idContainer].push(item.id);

              // increase total counters
              result[finalFollowupStatusEntry.counter]++;
              result[finalFollowupStatusEntry.idContainer].push(item.id);

              // calculate new percentage as the status is known
              // period percentage
              periodMap[casePeriodIdentifier].percentageOfCasesWithFollowupData =
                (periodMap[casePeriodIdentifier].totalCasesFromContactWithFollowupComplete +
                  periodMap[casePeriodIdentifier].totalCasesFromContactWithFollowupLostToFollowup) /
                periodMap[casePeriodIdentifier].totalCasesCount;

              // total percentage
              result.percentageOfCasesWithFollowupData =
                (result.totalCasesFromContactWithFollowupComplete +
                  result.totalCasesFromContactWithFollowupLostToFollowup) /
                result.totalCasesCount;
            } else {
              // case was created from a contact that has an unknown (not default reference data) follow-up status
              // it was already added in the total cases count; no need to add in another counter
            }
          }
        });

        // update results; sending array with period entries
        result.period = Object.values(periodMap);

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Build and return a pdf containing a case's information, relationships and lab results (dossier)
   * @param cases
   * @param anonymousFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.caseDossier = function (cases, anonymousFields, options, callback) {
    // reference shortcuts
    const models = app.models;

    // create a temporary directory to store generated pdfs that are included in the final archive
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const tmpDirName = tmpDir.name;

    // current user language
    const languageId = options.remotingContext.req.authData.user.languageId;

    // questionnaires to be included in pdfs
    const labResultsTemplate = this.labResultsTemplate.toJSON();
    const caseInvestigationTemplate = this.caseInvestigationTemplate.toJSON();

    // initialize filter
    let filter = {
      where: {
        id: {
          inq: cases
        }
      },
      include: [
        {
          relation: 'relationships',
          scope: {
            include: [
              {
                relation: 'people'
              },
              {
                relation: 'cluster'
              }
            ]
          }
        },
        {
          relation: 'labResults'
        }
      ]
    };

    let that = this;

    // add geographical restrictions if needed
    // Note: even though the given cases should already be in the geographical restriction
    // we are adding this additional condition to prevent security breaches
    app.models.case
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // get all requested cases, including their relationships and lab results
        that.__get__cases(filter, (err, results) => {
          if (err) {
            return callback(err);
          }

          const sanitizedCases = [];

          genericHelpers.attachLocations(
            app.models.case,
            app.models.location,
            results,
            (err, result) => {
              if (!err) {
                result = result || {};
                results = result.records || results;
              }

              // get the language dictionary
              app.models.language.getLanguageDictionary(languageId, (err, dictionary) => {
                if (err) {
                  return callback(err);
                }

                // translate lab results/case investigation questionnaires
                const labResultsQuestionnaire = Outbreak.helpers.parseTemplateQuestions(labResultsTemplate, dictionary);
                const caseInvestigationQuestionnaire = Outbreak.helpers.parseTemplateQuestions(caseInvestigationTemplate, dictionary);

                // transform all DB models into JSONs for better handling
                // we call the variable "person" only because "case" is a javascript reserved word
                results.forEach((person, caseIndex) => {
                  results[caseIndex] = person.toJSON();
                  // this is needed because loopback doesn't return hidden fields from definition into the toJSON call
                  // might be removed later
                  results[caseIndex].type = person.type;

                  // since relationships is a custom relation, the relationships collection is included differently in the case model,
                  // and not converted by the initial toJSON method.
                  person.relationships.forEach((relationship, relationshipIndex) => {
                    person.relationships[relationshipIndex] = relationship.toJSON();
                    person.relationships[relationshipIndex].people.forEach((member, memberIndex) => {
                      person.relationships[relationshipIndex].people[memberIndex] = member.toJSON();
                    });
                  });
                });

                // replace all foreign keys with readable data
                genericHelpers.resolveModelForeignKeys(app, models.case, results, dictionary)
                  .then((results) => {
                    // transform the model into a simple JSON
                    results.forEach((person, caseIndex) => {
                      // keep the initial data of the case (we currently use it to generate the QR code only)
                      sanitizedCases[caseIndex] = {
                        rawData: person,
                        relationships: [],
                        labResults: []
                      };

                      // anonymize the required fields and prepare the fields for print (currently, that means eliminating undefined values,
                      // and formatting date type fields
                      if (anonymousFields) {
                        app.utils.anonymizeDatasetFields.anonymize(person, anonymousFields);
                      }

                      app.utils.helpers.formatDateFields(person, app.models.person.dossierDateFields);
                      app.utils.helpers.formatUndefinedValues(person);

                      // prepare the case's relationships for printing
                      person.relationships.forEach((relationship, relationshipIndex) => {
                        // extract the person with which the case has a relationship
                        let relationshipMember = _.find(relationship.people, (member) => {
                          return member.id !== person.id;
                        });

                        // if relationship member was not found
                        if (!relationshipMember) {
                          // stop here (invalid relationship)
                          return;
                        }

                        // needed for checks below
                        const relationshipMemberType = relationshipMember.type;
                        const isEvent = relationshipMemberType === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT';

                        // for events, keep only the properties needed to be printed
                        // because we don't ever fill inherited person's properties for events
                        if (isEvent) {
                          let tmpObject = {};
                          for (let prop in relationshipMember) {
                            if (app.models.event.printFieldsinOrder.indexOf(prop) !== -1) {
                              tmpObject[prop] = relationshipMember[prop];
                            }
                          }
                          relationshipMember = tmpObject;
                        }

                        // translate the values of the fields marked as reference data fields on the case/contact/event model
                        app.utils.helpers.translateDataSetReferenceDataValues(
                          relationshipMember,
                          app.models[models.person.typeToModelMap[relationshipMemberType]].referenceDataFields,
                          dictionary
                        );

                        relationshipMember = app.utils.helpers.translateFieldLabels(
                          app,
                          relationshipMember,
                          models[models.person.typeToModelMap[relationshipMemberType]].modelName,
                          dictionary
                        );

                        // translate the values of the fields marked as reference data fields on the relationship model
                        app.utils.helpers.translateDataSetReferenceDataValues(relationship, models.relationship.referenceDataFields, dictionary);

                        // translate all remaining keys of the relationship model
                        relationship = app.utils.helpers.translateFieldLabels(app, relationship, models.relationship.modelName, dictionary);

                        relationship[dictionary.getTranslation('LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON')] = relationshipMember;

                        // add the sanitized relationship to the object to be printed
                        sanitizedCases[caseIndex].relationships[relationshipIndex] = relationship;
                      });

                      // prepare the case's lab results and lab results questionnaires for printing
                      person.labResults.forEach((labResult, labIndex) => {
                        // translate the values of the fields marked as reference data fields on the lab result model
                        app.utils.helpers.translateDataSetReferenceDataValues(labResult, models.labResult.referenceDataFields, dictionary);

                        // clone the questionnaires, as the function below is actually altering them
                        let labResultsQuestions = _.cloneDeep(labResultsQuestionnaire);

                        // convert questionnaire answers to old format, before doing anything
                        let labResultAnswers = labResult.questionnaireAnswers || {};

                        // since we are presenting all the answers, mark the one that was selected, for each question
                        labResultsQuestions = Outbreak.helpers.prepareQuestionsForPrint(labResultAnswers, labResultsQuestions);

                        // translate the remaining fields on the lab result model
                        labResult = app.utils.helpers.translateFieldLabels(app, labResult, models.labResult.modelName, dictionary);

                        // add the questionnaire separately (after field translations) because it will be displayed separately
                        labResult.questionnaire = labResultsQuestions;

                        // add the sanitized lab results to the object to be printed
                        sanitizedCases[caseIndex].labResults[labIndex] = labResult;
                      });

                      // clone the questionnaires, as the function below is actually altering them
                      let caseInvestigationQuestions = _.cloneDeep(caseInvestigationQuestionnaire);

                      // convert questionnaire answers to old format, before doing anything
                      let personAnswers = person.questionnaireAnswers || {};

                      // since we are presenting all the answers, mark the one that was selected, for each question
                      caseInvestigationQuestions = Outbreak.helpers.prepareQuestionsForPrint(personAnswers, caseInvestigationQuestions);

                      // translate all remaining keys
                      person = app.utils.helpers.translateFieldLabels(
                        app,
                        person,
                        models.case.modelName,
                        dictionary,
                        true
                      );

                      // add the questionnaire separately (after field translations) because it will be displayed separately
                      person.questionnaire = caseInvestigationQuestions;

                      // add the sanitized case to the object to be printed
                      sanitizedCases[caseIndex].data = person;
                    });

                    // translate the pdf section titles
                    const caseDetailsTitle = dictionary.getTranslation('LNG_PAGE_TITLE_CASE_DETAILS');
                    const caseQuestionnaireTitle = dictionary.getTranslation('LNG_PAGE_TITLE_CASE_QUESTIONNAIRE');
                    const relationshipsTitle = dictionary.getTranslation('LNG_PAGE_ACTION_RELATIONSHIPS');
                    const labResultsTitle = dictionary.getTranslation('LNG_PAGE_LIST_ENTITY_LAB_RESULTS_TITLE');
                    const labResultsQuestionnaireTitle = dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_QUESTIONNAIRE');

                    let pdfPromises = [];

                    // Print all the data
                    sanitizedCases.forEach((sanitizedCase) => {
                      pdfPromises.push(
                        new Promise((resolve, reject) => {
                          // generate pdf document
                          let doc = pdfUtils.createPdfDoc({
                            fontSize: 7,
                            layout: 'portrait',
                            margin: 20,
                            lineGap: 0,
                            wordSpacing: 0,
                            characterSpacing: 0,
                            paragraphGap: 0
                          });

                          // add a top margin of 2 lines for each page
                          doc.on('pageAdded', () => {
                            doc.moveDown(2);
                          });

                          // set margin top for first page here, to not change the entire createPdfDoc functionality
                          doc.moveDown(2);
                          // write this as a separate function to easily remove it's listener
                          let addQrCode = function () {
                            app.utils.qrCode.addPersonQRCode(doc, sanitizedCase.rawData.outbreakId, 'case', sanitizedCase.rawData);
                          };

                          // add the QR code to the first page (this page has already been added and will not be covered by the next line)
                          addQrCode();

                          // set a listener on pageAdded to add the QR code to every new page
                          doc.on('pageAdded', addQrCode);

                          // remove the questionnaire from case printing model
                          const caseQuestionnaire = sanitizedCase.data.questionnaire;
                          delete sanitizedCase.data.questionnaire;

                          // display case details
                          pdfUtils.displayModelDetails(doc, sanitizedCase.data, true, caseDetailsTitle);

                          // display case investigation questionnaire
                          doc.addPage();
                          pdfUtils.createQuestionnaire(doc, caseQuestionnaire, true, caseQuestionnaireTitle);

                          // display case's relationships
                          pdfUtils.displayPersonRelationships(doc, sanitizedCase.relationships, relationshipsTitle);

                          // display lab results and questionnaires
                          pdfUtils.displayPersonSectionsWithQuestionnaire(doc, sanitizedCase.labResults, labResultsTitle, labResultsQuestionnaireTitle);

                          // add an additional empty page that contains only the QR code as per requirements
                          doc.addPage();

                          // stop adding this QR code. The next contact will need to have a different QR code
                          doc.removeListener('pageAdded', addQrCode);
                          doc.end();

                          // convert pdf stream to buffer and send it as response
                          genericHelpers.streamToBuffer(doc, (err, buffer) => {
                            if (err) {
                              reject(err);
                            } else {
                              // construct file name
                              const fileName = exportHelper.getNameForExportedDossierFile(sanitizedCase, anonymousFields);
                              fs.writeFile(`${tmpDirName}/${fileName}`, buffer, (err) => {
                                if (err) {
                                  reject(err);
                                } else {
                                  resolve();
                                }
                              });
                            }
                          });
                        })
                      );
                    });
                    return Promise.all(pdfPromises);
                  })
                  .then(() => {
                    let archiveName = `caseDossiers_${localizationHelper.now().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
                    let archivePath = `${tmpDirName}/${archiveName}`;
                    let zip = new AdmZip();

                    zip.addLocalFolder(tmpDirName);
                    zip.writeZip(archivePath);

                    fs.readFile(archivePath, (err, data) => {
                      if (err) {
                        callback(apiError.getError('FILE_NOT_FOUND'));
                      } else {
                        tmpDir.removeCallback();
                        app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
                      }
                    });
                  })
                  .catch(callback);
              });
            });
        });
      })
      .catch(callback);
  };

  /**
   * Return a collection of items that contain a location and the cases that belong to that location.
   * Structure the data so that the response is consistent with other similar requests.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCasesPerLocationLevel = function (filter, options, callback) {
    // define additional filter to exclude cases of no interest
    const additionalFilter = {
      where: {
        classification: {
          nin: app.models.case.discardedCaseClassifications
        }
      }
    };

    // Merge the additional filter with the filter provided by the user
    const _filter = app.utils.remote.mergeFilters(additionalFilter, filter || {});

    // count people per location
    app.models.person.getPeoplePerLocation('case', _filter, this, options)
      .then((result) => {
        let response = {locations: []};
        let allCasesCount = 0;
        result.peopleDistribution.forEach((dataSet) => {
          // ignore no location records
          if (dataSet.location.id === app.models.location.noLocation.id) {
            return;
          }

          // set data
          dataSet.casesCount = dataSet.people.length;
          allCasesCount += dataSet.people.length;
          dataSet.caseIds = dataSet.people.map(caseModel => caseModel.id);
          delete dataSet.people;
          response.locations.push(dataSet);
        });
        response.count = allCasesCount;
        callback(null, response);
      })
      .catch(callback);
  };

  /**
   * Find list of case main addresses that have geo location and match search criteria
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getCaseCountMap = function (where, options, callback) {
    // construct case count map filter
    const whereCaseCountMap = {
      classification: {
        $nin: app.models.case.discardedCaseClassifications
      },
      addresses: {
        $elemMatch: {
          typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
          'geoLocation.coordinates': {
            $exists: true
          }
        }
      }
    };

    // merge conditions
    if (where) {
      // check relationship
      let relationship;
      if (where.relationship) {
        relationship = where.relationship;
        delete where.relationship;
      }

      // check lab result
      let labResult;
      if (where.labResult) {
        labResult = where.labResult;
        delete where.labResult;
      }

      // re-create where
      where = {
        $and: [
          whereCaseCountMap,
          where
        ]
      };

      // re-add relationship
      if (
        relationship &&
        Object.keys(relationship).length
      ) {
        where.relationship = relationship;
      }

      // re-add lab result
      if (
        labResult &&
        Object.keys(labResult).length
      ) {
        where.labResult = labResult;
      }
    } else {
      where = whereCaseCountMap;
    }

    // pre-filter using related data (case)
    // IMPORTANT: required to add geographical restrictions filters
    app.models.case
      .preFilterForOutbreak(this, {where: where}, options)
      .then(function (filter) {
        // retrieve in bulks
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // initialize parameters for handleActionsInBatches call
        const getActionsCount = () => {
          return Promise.resolve()
            .then(() => {
              // count cases that match search criteria
              return app.models.case
                .count(filter.where);
            });
        };

        // get cases for batch
        const getBatchData = (batchNo, batchSize) => {
          return app.models.case
            .rawFind(
              filter.where, {
                order: {
                  createdAt: 1
                },
                projection: {
                  addresses: 1
                },
                skip: (batchNo - 1) * batchSize,
                limit: batchSize,
              }
            );
        };

        // batch item actions
        // keep a list of addresses that we need to return
        const geoPoints = [];
        const batchItemsAction = (cases) => {
          // go through cases and determine main addresses
          cases.forEach(function (caseData) {
            // find usual place of residence
            const caseAddresses = caseData.addresses || [];
            for (const addressIndex in caseAddresses) {
              // found ?
              const address = caseAddresses[addressIndex];
              if (
                address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE' &&
                address.geoLocation &&
                address.geoLocation.coordinates &&
                address.geoLocation.coordinates.length > 1
              ) {
                // add point
                geoPoints.push({
                  lat: address.geoLocation.coordinates[1],
                  lng: address.geoLocation.coordinates[0]
                });

                // finished
                break;
              }
            }
          });

          // finished
          return Promise.resolve();
        };

        // execute jobs in batches
        return app.utils.helpers
          .handleActionsInBatches(
            getActionsCount,
            getBatchData,
            batchItemsAction,
            null,
            caseCountMapBatchSize,
            10,
            console
          )
          .then(() => {
            return callback(null, geoPoints);
          });
      })
      .catch(callback);
  };

  /**
   * Retrieve available people for a case
   * @param caseId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getCaseRelationshipsAvailablePeople = function (caseId, filter, options, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        caseId,
        filter,
        options
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for a case
   * @param caseId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCaseRelationshipsAvailablePeople = function (caseId, filter, options, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        caseId,
        filter,
        options
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Get all duplicates based on hardcoded rules against a model props
   * @param model
   * @param options
   * @param callback
   */
  Outbreak.prototype.getCasePossibleDuplicates = function (model = {}, options, callback) {
    if (
      Config.duplicate &&
      Config.duplicate.disableCaseDuplicateCheck
    ) {
      callback(null, []);
    } else {
      app.models.person
        .findDuplicatesByType(this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', model, options)
        .then(duplicates => callback(null, duplicates))
        .catch(callback);
    }
  };

  /**
   * Convert a case to a contact
   * @param caseId
   * @param options
   * @param callback
   */
  Outbreak.prototype.convertCaseToContact = function (caseId, options, callback) {
    let caseInstance, convertedContact;
    app.models.case
      .findOne({
        where: {
          id: caseId
        },
        fields: [
          'id',
          'questionnaireAnswers',
          'questionnaireAnswersContact'
        ]
      })
      .then(function (caseModel) {
        if (!caseModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.case.modelName, id: caseId});
        }

        // keep the caseModel as we will do actions on it
        caseInstance = caseModel;

        // in order for a case to be converted to a contact it must be related to at least another case/event and it must be a target in that relationship
        // check relations
        return app.models.relationship
          .rawCountDocuments({
            where: {
              // required to use index to improve greatly performance
              'persons.id': caseId,

              $or: [
                {
                  'persons.0.id': caseId,
                  'persons.0.target': true,
                  'persons.1.type': {
                    $in: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
                  }
                },
                {
                  'persons.1.id': caseId,
                  'persons.1.target': true,
                  'persons.0.type': {
                    $in: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
                  }
                }
              ]
            }
          }, {
            limit: 1,
            // required to use index to improve greatly performance
            hint: {
              'persons.id': 1
            }
          });
      })
      .then(function (response) {
        if (!response.count) {
          // the case doesn't have relations with other cases; stop conversion
          throw app.utils.apiError.getError('INVALID_CASE_RELATIONSHIP', {id: caseId});
        }

        // define the attributes for update
        const attributes = {
          dateBecomeContact: localizationHelper.today().toDate(),
          wasCase: true,
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        };

        // retain data from custom forms upon conversion
        if (!_.isEmpty(caseInstance.questionnaireAnswers)) {
          attributes.questionnaireAnswersCase = Object.assign({}, caseInstance.questionnaireAnswers);
          attributes.questionnaireAnswers = {};
        }

        // restore data from custom forms before conversion
        if (!_.isEmpty(caseInstance.questionnaireAnswersContact)) {
          attributes.questionnaireAnswers = Object.assign({}, caseInstance.questionnaireAnswersContact);
          attributes.questionnaireAnswersContact = {};
        }

        // the case has relations with other cases; proceed with the conversion
        return app.models.person.rawUpdateOne(
          {
            _id: caseId
          },
          attributes,
          options
        );
      })
      .then(() => {
        return app.models.contact.findOne({
          where: {
            id: caseId
          }
        });
      })
      .then(function (contact) {
        if (!contact) {
          // the case doesn't have relations with other cases; stop conversion
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: caseId});
        }

        // keep the contact as we will do actions on it
        convertedContact = contact;

        // after updating the case, find it's relations
        return app.models.relationship
          .find({
            where: {
              'persons.id': caseId
            }
          });
      })
      .then(function (relations) {
        // check if there are relations
        if (!relations.length) {
          return;
        }

        // update relations
        const updateRelations = [];
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (person.id === caseId) {
              // update type to match the new one
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        // update personType from lab results
        return app.models.labResult
          .rawBulkUpdate(
            {
              personId: caseId
            },
            {
              personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            options
          );
      })
      .then(function () {
        callback(null, convertedContact);
      })
      .catch(callback);
  };

  /**
   * Import an importable cases file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableCasesFileUsingMap = function (body, options, callback) {
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
     * @returns {Promise<*[]>}
     */
    const createBatchActions = function (batchData) {
      return genericHelpers.fillGeoLocationInformation(batchData, 'save.addresses', app)
        .then(() => {
          // build a list of create operations for this batch
          const createCases = [];

          // go through all batch entries
          batchData.forEach(function (caseData) {
            createCases.push(function (asyncCallback) {
              // sync the case
              return app.utils.dbSync.syncRecord(app, logger, app.models.case, caseData.save, options)
                .then(function () {
                  asyncCallback();
                })
                .catch(function (error) {
                  asyncCallback(null, {
                    success: false,
                    error: {
                      error: error,
                      data: {
                        file: caseData.raw,
                        save: caseData.save
                      }
                    }
                  });
                });
            });
          });

          return createCases;
        });
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.case,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    let modelDateProperties =  genericHelpers.getModelPropertiesByDataType(
      app.models.case,
      genericHelpers.DATA_TYPE.DATE
    );

    // add the "date" properties of the questionnaire
    const questionnaireDateProperties = [];
    genericHelpers.getQuestionnaireDateProperties(
      questionnaireDateProperties,
      self.caseInvestigationTemplate ?
        self.caseInvestigationTemplate.toJSON() :
        undefined
    );
    modelDateProperties = modelDateProperties.concat(questionnaireDateProperties);

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'case',
      batchSize: caseImportBatchSize,
      outbreakId: self.id,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.case.modelName,
      outbreakId: self.id,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };
};
