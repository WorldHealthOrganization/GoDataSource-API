'use strict';

const app = require('../../server/server');
const casesWorker = require('../../components/workerRunner').cases;
const _ = require('lodash');
const moment = require('moment');
const helpers = require('../../components/helpers');
const async = require('async');

module.exports = function (Case) {
  Case.getIsolatedContacts = function (caseId, callback) {
    // get all relations with a contact
    return app.models.relationship
      .rawFind({
        $or: [
          {
            'persons.0.id': caseId,
            'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          },
          {
            'persons.1.id': caseId,
            'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          }
        ]
      })
      .then((relationships) => {
        async.parallelLimit(relationships.map((rel) => {
          const contact = rel.persons.find((p) => p.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');
          return (cb) => {
            app.models.contact
              .find({
                where: {
                  id: contact.id
                }
              })
              .then((contacts) => {
                // contact missing ?
                if (_.isEmpty(contacts)) {
                  cb(null, {isValid: false});
                  return;
                }

                // retrieve contact
                const contact = contacts[0];
                // get all relations of the contact that are not with this case
                app.models.relationship
                  .rawFind({
                    $or: [
                      {
                        'persons.0.id': contact.id,
                        'persons.1.id': {
                          $ne: caseId
                        }
                      },
                      {
                        'persons.0.id': {
                          $ne: caseId
                        },
                        'persons.1.id': contact.id
                      }
                    ]
                  })
                  .then((relationships) => cb(null, {contact: contact, isValid: !relationships.length}));
              })
              .catch((error) => cb(error));
          };
        }), 10, (err, possibleIsolatedContacts) => {
          if (err) {
            return callback(err);
          }
          return callback(null, possibleIsolatedContacts.filter((entry) => entry.isValid));
        });
      });
  };

  Case.observe('after delete', (context, next) => {
    const caseId = context.instance.id;
    Case.getIsolatedContacts(caseId, (err, isolatedContacts) => {
      if (err) {
        return next(err);
      }

      // construct the list of contacts that we need to remove
      const contactsJobs = [];
      isolatedContacts.forEach((isolatedContact) => {
        if (isolatedContact.isValid) {
          // remove contact job
          contactsJobs.push((function (contactModel) {
            return (callback) => {
              contactModel.destroy(
                {
                  extraProps: {
                    deletedByParent: caseId
                  }
                },
                callback
              );
            };
          })(isolatedContact.contact));
        }
      });

      // delete each isolated contact & and its relationship
      async.parallelLimit(contactsJobs, 10, function (error) {
        next(error);
      });
    });
  });

  // set flag to not get controller
  Case.hasController = false;

  // list of case classifications that are discarded
  Case.discardedCaseClassifications = [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED'
  ];

  Case.sectionsFieldLabels = {
    personalInformation: {
      title: 'LNG_FORM_CASE_QUICK_LABEL_PERSONAL',
      labels: [
        'LNG_CASE_FIELD_LABEL_FIRST_NAME',
        'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
        'LNG_CASE_FIELD_LABEL_LAST_NAME',
        'LNG_CASE_FIELD_LABEL_GENDER',
        'LNG_CASE_FIELD_LABEL_OCCUPATION',
        'LNG_CASE_FIELD_LABEL_AGE',
        'LNG_CASE_FIELD_LABEL_DOB',
        'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
        'LNG_CASE_FIELD_LABEL_RISK_REASON',
        'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
        'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
        'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',

      ]
    },
    addresses: {
      title: 'LNG_CASE_FIELD_LABEL_ADDRESSES',
      labels: [
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
        'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
        'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
        'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER'
      ]
    },
    documents: {
      title: 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
      labels: [
        'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
        'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER'
      ]
    },
    epidemiology: {
      title: 'LNG_PAGE_CREATE_CASE_TAB_INFECTION_TITLE',
      labels: [
        'LNG_CASE_FIELD_LABEL_CLASSIFICATION',
        'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
        'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET_APPROXIMATE',
        'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
        'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
        'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
        'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME'
      ]
    }
  };

  // map language token labels for model properties
  Case.fieldLabelsMap = Object.assign({}, Case.fieldLabelsMap, {
    'firstName': 'LNG_CASE_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CASE_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CASE_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CASE_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CASE_FIELD_LABEL_AGE',
    'age.years': 'LNG_CASE_FIELD_LABEL_AGE_YEARS',
    'age.months': 'LNG_CASE_FIELD_LABEL_AGE_MONTHS',
    'dob': 'LNG_CASE_FIELD_LABEL_DOB',
    'classification': 'LNG_CASE_FIELD_LABEL_CLASSIFICATION',
    'dateBecomeCase': 'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
    'wasContact': 'LNG_CASE_FIELD_LABEL_WAS_CONTACT',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'isDateOfOnsetApproximate': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET_APPROXIMATE',
    'dateOfReporting': 'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'dateRanges': 'LNG_CASE_FIELD_LABEL_DATE_RANGES',
    'dateRanges[].typeId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_TYPE_ID',
    'dateRanges[].startDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_START_DATE',
    'dateRanges[].endDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_END_DATE',
    'dateRanges[].centerName': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_CENTER_NAME',
    'dateRanges[].locationId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_LOCATION',
    'dateRanges[].comments': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_COMMENTS',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'documents[].type': 'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'addresses[].typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'addresses[].country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'addresses[].city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addresses[].addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addresses[].addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'addresses[].postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'addresses[].locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'addresses[].geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'addresses[].geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'addresses[].geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'addresses[].geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'addresses[].phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'visualId': 'LNG_CASE_FIELD_LABEL_VISUAL_ID',
    'isDateOfReportingApproximate': 'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'questionnaireAnswers': 'LNG_CASE_FIELD_LABEL_QUESTIONNAIRE_ANSWERS',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CASE_FIELD_LABEL_DATE_OF_BURIAL',
    'burialLocationId': 'LNG_CASE_FIELD_LABEL_BURIAL_LOCATION_ID',
    'burialPlaceName': 'LNG_CASE_FIELD_LABEL_BURIAL_PLACE_NAME',
    'vaccinesReceived': 'LNG_CASE_FIELD_LABEL_VACCINES_RECEIVED',
    'vaccinesReceived[].vaccine': 'LNG_CASE_FIELD_LABEL_VACCINE',
    'vaccinesReceived[].date': 'LNG_CASE_FIELD_LABEL_VACCINE_DATE',
    'vaccinesReceived[].status': 'LNG_CASE_FIELD_LABEL_VACCINE_STATUS',
    'pregnancyStatus': 'LNG_CASE_FIELD_LABEL_PREGNANCY_STATUS'
  });

  Case.exportFieldsOrder = [
    'id',
    'visualId',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ];

  Case.arrayProps = {
    dateRanges: {
      'typeId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_TYPE_ID',
      'startDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_START_DATE',
      'endDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_END_DATE',
      'centerName': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_CENTER_NAME',
      'locationId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_LOCATION',
      'comments': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_COMMENTS',
    },
    addresses: {
      'typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
      'country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
      'city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
      'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
      'addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
      'postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
      'locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
      'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
      'geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
      'geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
      'geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
      'date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
      'phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    },
    documents: {
      'type': 'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
      'number': 'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER'
    },
    vaccinesReceived: {
      'vaccine': 'LNG_CASE_FIELD_LABEL_VACCINE',
      'date': 'LNG_CASE_FIELD_LABEL_VACCINE_DATE',
      'status': 'LNG_CASE_FIELD_LABEL_VACCINE_STATUS',
    }
  };

  Case.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    'dateRanges[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE',
    'vaccinesReceived[].vaccine': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
    'vaccinesReceived[].status': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
    pregnancyStatus: 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS'
  };

  Case.referenceDataFields = Object.keys(Case.referenceDataFieldsToCategoryMap);

  Case.extendedForm = {
    template: 'caseInvestigationTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };

  Case.printFieldsinOrder = [
    'visualId',
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dob',
    'age',
    'occupation',
    'addresses',
    'documents',
    'type',
    'classification',
    'riskLevel',
    'riskReason',
    'wasContact',
    'dateOfReporting',
    'isDateOfReportingApproximate',
    'dateBecomeCase',
    'dateOfInfection',
    'dateOfOnset',
    'outcomeId',
    'dateOfOutcome',
    'dateRanges',
    'transferRefused',
    'safeBurial',
    'dateOfBurial',
    'burialLocationId',
    'burialPlaceName',
    'vaccinesReceived',
    'pregnancyStatus'
  ];

  Case.locationFields = [
    'addresses[].locationId',
    'dateRanges[].locationId',
    'burialLocationId'
  ];

  Case.foreignKeyResolverMap = {
    'burialLocationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'dateRanges[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].clusterId': {
      modelName: 'cluster',
      useProperty: 'name'
    },
    'relationships[].people[].addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].address.locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].burialLocationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].dateRanges[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    }
  };

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Case.nestedGeoPoints = [
    'addresses[].geoLocation'
  ];

  Case.invalidCaseClassificationsForReports = [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED'
  ];

  // this is solely used for attaching parent locations custom fields in prints
  // addresses and dateRanges location ids are being handled inside their own models
  Case.locationsFieldsMap = {
    burialLocationId: 'LNG_CASE_FIELD_LABEL_BURIAL_LOCATION_ID'
  };

  /**
   * Archive case classification changes, when detected
   * @param context
   */
  function archiveClassificationChanges(context) {
    // get data from context
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // get data source
    const dataSource = data.source.all;
    // start with unknown last classification
    let lastKnownClassification;
    // if there is a non-empty classification history
    if (Array.isArray(dataSource.classificationHistory) && dataSource.classificationHistory.length) {
      // find the last known case classification
      lastKnownClassification = dataSource.classificationHistory.find(classification => classification.endDate == null);
    }
    // if the last known classification was found
    if (lastKnownClassification) {
      // if it's different than current classification
      if (dataSource.classification !== lastKnownClassification.classification) {
        // end last known classification entry
        lastKnownClassification.endDate = new Date();
        // add the new classification in the history
        dataSource.classificationHistory.push({
          classification: dataSource.classification,
          startDate: lastKnownClassification.endDate
        });
      }
      // update classification history
      data.target.classificationHistory = dataSource.classificationHistory;

    } else {
      // no last known classification, get existing classification history (if any)
      data.target.classificationHistory = dataSource.classificationHistory;
      // if there is no classification history
      if (!Array.isArray(data.target.classificationHistory)) {
        // start it now
        data.target.classificationHistory = [];
      }
      // add current classification to history
      data.target.classificationHistory.push({
        classification: dataSource.classification,
        startDate: new Date()
      });
    }
  }

  /**
   * Before save hooks
   */
  Case.observe('before save', function (context, next) {
    // archive
    archiveClassificationChanges(context);

    // sort multi answer questions
    const data = context.isNewInstance ? context.instance : context.data;
    helpers.sortMultiAnswerQuestions(data);

    // retrieve outbreak data
    let model = _.get(context, 'options.remotingContext.instance');
    if (model) {
      if (!(model instanceof app.models.outbreak)) {
        model = undefined;
      }
    }

    // convert date fields to date before saving them in database
    helpers
      .convertQuestionStringDatesToDates(
        data,
        model ?
          model.caseInvestigationTemplate :
          null
      )
      .then(() => {
        // finished
        next();
      })
      .catch(next);
  });

  /**
   * Count cases stratified by category over time
   * @param outbreak
   * @param referenceDataCategoryId
   * @param timePropertyName
   * @param exportedPropertyName
   * @param counterFn
   * @param filter
   * @returns {PromiseLike<any | never>}
   */
  Case.countStratifiedByCategoryOverTime = function (outbreak, referenceDataCategoryId, timePropertyName, exportedPropertyName, counterFn, filter) {
    // initialize periodType filter; default is day; accepting day/week/month
    let periodType, endDate;
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

    // check if the periodType filter was sent; accepting it only on the first level
    endDate = _.get(filter, 'where.endDate');
    if (typeof endDate !== 'undefined') {
      // periodType was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.endDate;
    }

    // always work with end of day
    if (endDate) {
      // get end of day for specified date
      endDate = app.utils.helpers.getDateEndOfDay(endDate);
    } else {
      // nothing sent, use current day's end of day
      endDate = app.utils.helpers.getDateEndOfDay();
    }

    // make sure end date is after start date
    const startDate = app.utils.helpers.getDate(outbreak.startDate);
    if (endDate.isBefore(startDate)) {
      endDate = app.utils.helpers.getDateEndOfDay(startDate);
    }

    // define period interval
    const periodInterval = [
      startDate,
      endDate
    ];

    // build period map
    const periodMap = app.utils.helpers.getChunksForInterval(periodInterval, periodType);

    // get available case categories
    const categoryList = {};
    return app.models.referenceData
      .find({
        where: {
          categoryId: referenceDataCategoryId
        }
      })
      .then(function (categoryItems) {
        // add default entries for all categoryItems
        categoryItems.forEach(function (categoryItem) {
          categoryList[categoryItem.id] = 0;
        });
        // add case categoryItems to periodMap
        Object.keys(periodMap)
          .forEach(function (periodMapIndex) {
            Object.assign(periodMap[periodMapIndex], {
              [exportedPropertyName]: categoryList,
              total: 0
            });
          });
      })
      .then(function () {
        // find cases that have <timePropertyName> earlier then end of the period interval
        return app.models.case
          .rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(
              app.utils.remote.mergeFilters({
                where: {
                  outbreakId: outbreak.id,
                  [timePropertyName]: {
                    gte: new Date(periodInterval[0]),
                    lte: new Date(periodInterval[1])
                  }
                }
              }, filter || {}).where
            )
          )
          .then(function (cases) {
            return new Promise(function (resolve, reject) {
              // count categories over time
              counterFn(cases, periodInterval, periodType, periodMap, categoryList, function (error, periodMap) {
                // handle errors
                if (error) {
                  return reject(error);
                }
                // send back the result
                return resolve(periodMap);
              });
            });
          });
      });
  };


  /**
   * Count cases stratified by classification over time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByClassificationOverTime = function (outbreak, filter) {
    return Case.countStratifiedByCategoryOverTime(
      outbreak,
      'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'dateOfOnset',
      'classification',
      casesWorker.countStratifiedByClassificationOverTime,
      filter
    );
  };

  /**
   * Count cases stratified by outcome over time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByOutcomeOverTime = function (outbreak, filter) {
    return Case.countStratifiedByCategoryOverTime(
      outbreak,
      'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
      'dateOfOutcome',
      'outcome',
      casesWorker.countStratifiedByOutcomeOverTime,
      filter
    );
  };

  /**
   * Count cases stratified by classification over reporting time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByClassificationOverReportingTime = function (outbreak, filter) {
    return Case.countStratifiedByCategoryOverTime(
      outbreak,
      'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'dateOfReporting',
      'classification',
      casesWorker.countStratifiedByClassificationOverReportingTime,
      filter
    );
  };

  /**
   * Get a list of entries that show the delay between date of symptom onset and the lab testing for a case
   * @param outbreakId
   * @param filter
   * @return {*}
   */
  Case.delayBetweenOnsetAndLabTesting = function (outbreakId, filter) {
    // find all cases that have date of onset defined and include their first lab result
    return Case
      .rawFind(
        app.utils.remote.convertLoopbackFilterToMongo(
          app.utils.remote.mergeFilters({
            where: {
              outbreakId: outbreakId,
              dateOfOnset: {
                ne: null
              }
            }
          }, filter || {})
        ).where, {
          order: {
            dateOfOnset: 1
          }
        }
      )
      .then(function (cases) {
        // build a list of caseIds to get their lab results
        const caseIds = cases.map(caseRecord => caseRecord.id);
        // do a raw find for lab results
        return app.models.labResult.rawFind(
          {
            personId: {
              inq: caseIds
            }
          },
          {
            order: {dateSampleTaken: 1},
            projection: {personId: 1, dateSampleTaken: 1}
          })
          .then(function (labResults) {
            // build a map of personId to oldest lab result
            const labResultsMap = {};
            // go through all lab results
            labResults.forEach(function (labResult) {
              // initialize case group if necessary
              if (!labResultsMap[labResult.personId]) {
                labResultsMap[labResult.personId] = [];
              }

              // keep all lab tests for each case
              labResultsMap[labResult.personId].push(labResult);
            });

            // go through case records & build the list of results
            const results = [];
            cases.forEach(function (caseRecord) {
              // get case lab results if we have any
              const labResultData = labResultsMap[caseRecord.id] ? labResultsMap[caseRecord.id] : [];

              // go through each lab data & get lab result's dateSampleTaken
              // we need to use DO...WHILE because even if we don't have lab data for a case, we still need to send back an empty result
              let labResultIndex = 0;
              do {
                // get lab result if we have one
                const labResultDate = labResultData[labResultIndex] ? labResultData[labResultIndex].dateSampleTaken : null;

                // build each result
                const result = {
                  dateOfOnset: caseRecord.dateOfOnset,
                  dateSampleTaken: labResultDate,
                  delay: null,
                  case: caseRecord
                };

                // calculate delay if both dates are available (onset is ensured by the query)
                if (labResultDate) {
                  const onset = moment(result.dateOfOnset);
                  const labTest = moment(result.dateSampleTaken);
                  result.delay = labTest.diff(onset, 'days');
                }

                // add result to list
                results.push(result);

                // next lab result for this case
                labResultIndex++;
              } while (labResultIndex < labResultData.length);
            });

            // return the list of results
            return results;
          });
      });
  };


  /**
   * Get a list of entries that show the delay between date of symptom onset and the hospitalization/isolation dates a case
   * @param outbreakId
   * @param filter
   * @returns {Promise<Array | never>}
   */
  Case.delayBetweenOnsetAndHospitalisationIsolation = function (outbreakId, filter) {
    // find all cases that have date of onset defined
    return Case
      .rawFind(
        app.utils.remote.convertLoopbackFilterToMongo(
          app.utils.remote.mergeFilters({
            where: {
              outbreakId: outbreakId,
              dateOfOnset: {
                ne: null
              }
            }
          }, filter || {})
        ).where, {
          order: {
            dateOfOnset: 1
          }
        }
      )
      .then(function (cases) {
        // build the list of results
        const results = [];
        // go through case records
        cases.forEach(function (caseRecord) {
          // get first hospitalisation/isolation date (if any)
          let hospitalizationIsolationDate;
          // hospitalization/isolation dates are types of date ranges, look for them in dateRanges list
          if (Array.isArray(caseRecord.dateRanges) && caseRecord.dateRanges.length) {
            hospitalizationIsolationDate = caseRecord.dateRanges
            // we need the earliest one, make sure the list is sorted accordingly
              .sort(function (a, b) {
                return a.startDate - b.startDate;
              })
              .find(function (dateRange) {
                return [
                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE_HOSPITALIZATION',
                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE_ISOLATION']
                  .includes(dateRange.typeId);
              });
          }
          // build each result
          const result = {
            dateOfOnset: caseRecord.dateOfOnset,
            hospitalizationIsolationDate: hospitalizationIsolationDate ? hospitalizationIsolationDate.startDate : undefined,
            delay: null,
            case: caseRecord
          };
          // calculate delay if both dates are available (onset is ensured by the query)
          if (hospitalizationIsolationDate) {
            const onset = moment(result.dateOfOnset);
            const hospitalisationIsolation = moment(hospitalizationIsolationDate.startDate);
            result.delay = hospitalisationIsolation.diff(onset, 'days');
          }
          results.push(result);
        });
        // return the list of results
        return results;
      });
  };

  /**
   * Pre-filter cases for an outbreak using related models (relationship)
   * @param outbreak
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @return {Promise<void | never>}
   */
  Case.preFilterForOutbreak = function (outbreak, filter) {
    // set a default filter
    filter = filter || {};
    // get relationship query, if any
    let relationshipQuery = _.get(filter, 'where.relationship');
    // if found, remove it form main query
    if (relationshipQuery) {
      delete filter.where.relationship;
    }
    // get labResults query, if any
    let labResultsQuery = _.get(filter, 'where.labResult');
    // if found, remove it form main query
    if (labResultsQuery) {
      delete filter.where.labResult;
    }
    // get main cases query
    let casesQuery = _.get(filter, 'where', {});
    // start with a resolved promise (so we can link others)
    let buildQuery = Promise.resolve();
    // if a relationship query is present
    if (relationshipQuery) {
      // restrict query to current outbreak
      relationshipQuery = {
        $and: [
          relationshipQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter relationships based on query
      buildQuery = buildQuery
        .then(function () {
          return app.models.relationship
            .rawFind(relationshipQuery, {projection: {persons: 1}})
            .then(function (relationships) {
              let caseIds = [];
              // build a list of caseIds that passed the filter
              relationships.forEach(function (relation) {
                relation.persons.forEach(function (person) {
                  if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
                    caseIds.push(person.id);
                  }
                });
              });
              return Array.from(new Set(caseIds));
            });
        });
    }
    // if lab results query is present
    if (labResultsQuery) {
      // filter lab results based on query
      buildQuery = buildQuery
        .then(function (caseIds) {
          // restrict lab results to current outbreak
          labResultsQuery = {
            and: [
              labResultsQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };
          // if case ids were found at previous step
          if (caseIds) {
            // restrict to only those people
            labResultsQuery.and.push(
              {
                personId: {
                  inq: caseIds
                }
              }
            );
          }
          // find lab results based on the query
          return app.models.labResult
            .rawFind(labResultsQuery, {projection: {personId: 1}})
            .then(function (labResults) {
              // return the list of caseIds associated with the found lab results
              return Array.from(new Set(labResults.map(labResult => labResult.personId)));
            });
        });
    }
    return buildQuery
      .then(function (caseIds) {
        // if caseIds filter present
        if (caseIds) {
          // update cases query to filter based on caseIds
          casesQuery = {
            and: [
              casesQuery,
              {
                id: {
                  inq: caseIds
                }
              }
            ]
          };
        }
        // restrict cases query to current outbreak
        casesQuery = {
          and: [
            casesQuery,
            {
              outbreakId: outbreak.id
            }
          ]
        };
        // return updated filter
        return Object.assign(filter, {where: casesQuery});
      });
  };

  /**
   * Migrate cases
   * @param options
   * @param next
   */
  Case.migrate = (options, next) => {
    // retrieve outbreaks data so we can migrate questionnaires accordingly to outbreak template definitiuon
    app.models.outbreak
      .find({}, {
        projection: {
          _id: 1,
          caseInvestigationTemplate: 1
        }
      })
      .then((outbreakData) => {
        // map outbreak data
        const outbreakTemplates = _.transform(
          outbreakData,
          (a, m) => {
            a[m.id] = m.caseInvestigationTemplate;
          },
          {}
        );

        // migrate dates & numbers
        helpers.migrateModelDataInBatches(Case, (modelData, cb) => {
          if (!_.isEmpty(modelData.questionnaireAnswers)) {
            // convert dates
            const questionnaireAnswersClone = _.cloneDeep(modelData.questionnaireAnswers);
            helpers
              .convertQuestionStringDatesToDates(
                modelData,
                outbreakTemplates[modelData.outbreakId]
              )
              .then(() => {
                // check if we have something to change
                if (_.isEqual(modelData.questionnaireAnswers, questionnaireAnswersClone)) {
                  // nothing to change
                  cb();
                } else {
                  // migrate
                  modelData
                    .updateAttributes({
                      questionnaireAnswers: modelData.questionnaireAnswers
                    }, options)
                    .then(() => cb())
                    .catch(cb);
                }
              })
              .catch(cb);
          } else {
            // nothing to do
            cb();
          }
        })
          .then(() => next())
          .catch(next);
      })
      .catch(next);
  };
};
