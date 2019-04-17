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
                  cb(null, { isValid: false });
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
                  .then((relationships) => cb(null, { contact: contact, isValid: !relationships.length }));
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
    Case.getIsolatedContacts(context.instance.id, (err, isolatedContacts) => {
      if (err) {
        return next(err);
      }

      // delete each isolated contact
      // do not wait for this, just continue with the execution flow
      isolatedContacts.forEach((isolatedContact) => {
        if (isolatedContact.isValid) {
          isolatedContact.contact.destroy();
        }
      });

      // fire and forget
      return next();
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
    'documents[].type': 'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER',
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
    'fillGeoLocation': 'LNG_CASE_FIELD_LABEL_FILL_GEO_LOCATION',
    'isDateOfReportingApproximate': 'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'questionnaireAnswers': 'LNG_CASE_FIELD_LABEL_QUESTIONNAIRE_ANSWERS',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CASE_FIELD_LABEL_DATE_OF_BURIAL'
  });

  Case.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    'dateRanges[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE'
  };

  Case.referenceDataFields = Object.keys(Case.referenceDataFieldsToCategoryMap);

  Case.extendedForm = {
    template: 'caseInvestigationTemplate',
    containerProperty: 'questionnaireAnswers'
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
    'dateBecomeCase',
    'dateOfInfection',
    'dateOfOnset',
    'outcomeId',
    'dateOfOutcome',
    'dateRanges',
    'transferRefused',
    'safeBurial',
    'dateOfBurial'
  ];

  Case.locationFields = [
    'addresses[].locationId',
    'dateRanges[].locationId'
  ];

  Case.foreignKeyResolverMap = {
    'addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'dateRanges[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].addresses[].locationId': {
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
    archiveClassificationChanges(context);
    helpers.sortMultiAnswerQuestions(context.isNewInstance ? context.instance : context.data);
    next();
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

    // define period interval
    const periodInterval = [
      outbreak.startDate,
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
   * Get Case transmission chains data
   * @param outbreakId
   * @param filter
   * @param callback
   */
  Case.getBarsTransmissionChainsData = function (outbreakId, filter, callback) {
    // convert filter to mongodb filter structure
    filter = filter || {};
    filter.where = filter.where || {};

    // parse filter
    const parsedFilter = app.utils.remote.convertLoopbackFilterToMongo(
      {
        $and: [
          // make sure we're only retrieve cases from the current outbreak
          {
            outbreakId: outbreakId
          },

          // retrieve only non-deleted records
          {
            $or: [{
              deleted: false
            }, {
              deleted: {
                $eq: null
              }
            }]
          },

          // filter only cases
          {
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
          },
          {
            classification: {
              nin: app.models.case.discardedCaseClassifications
            }
          },

          // conditions coming from request
          filter.where
        ]
      });

    // query aggregation
    const aggregatePipeline = [
      // match conditions
      {
        $match: parsedFilter
      },

      // retrieve lab results
      {
        $lookup: {
          from: 'labResult',
          localField: '_id',
          foreignField: 'personId',
          as: 'labResults'
        }
      },

      // retrieve relationships where case is source
      {
        $lookup: {
          from: 'relationship',
          localField: '_id',
          foreignField: 'persons.id',
          as: 'relationships'
        }
      },

      // filter & retrieve only needed data
      {
        $project: {
          // case fields
          id: '$_id',
          visualId: 1,
          firstName: 1,
          lastName: 1,
          dateOfOnset: 1,
          addresses: 1,
          dateRanges: {
            $map: {
              input: '$dateRanges',
              as: 'dateRange',
              in: {
                typeId: '$$dateRange.typeId',
                locationId: '$$dateRange.locationId',
                startDate: '$$dateRange.startDate',
                endDate: '$$dateRange.endDate'
              }
            }
          },

          // lab results fields
          labResults: {
            $map: {
              input: {
                $filter: {
                  input: '$labResults',
                  as: 'lab',
                  cond: {
                    $or: [{
                      $eq: ['$$lab.deleted', false]
                    }, {
                      $eq: ['$$lab.deleted', null]
                    }]
                  }
                }
              },
              as: 'lab',
              in: {
                dateSampleTaken: '$$lab.dateSampleTaken',
                testType: '$$lab.testType',
                result: '$$lab.result'
              }
            }
          },

          // relationship fields
          relationships: {
            $map: {
              input: {
                $filter: {
                  input: '$relationships',
                  as: 'rel',
                  cond: {
                    $or: [{
                      $eq: ['$$rel.deleted', false]
                    }, {
                      $eq: ['$$rel.deleted', null]
                    }]
                  }
                }
              },
              as: 'rel',
              in: {
                persons: '$$rel.persons'
              }
            }
          }
        }
      }
    ];

    // run request to db
    const cursor = app.dataSources.mongoDb.connector
      .collection('person')
      .aggregate(aggregatePipeline);

    // get the records from the cursor
    cursor
      .toArray()
      .then((records) => {
        // sort by date method
        const compareDates = (date1, date2) => {
          // compare missing dates & dates
          if (!date1 && !date2) {
            return 0;
          } else if (!date1) {
            return 1;
          } else if (!date2) {
            return -1;
          } else {
            // compare dates
            return moment(date1).diff(moment(date2));
          }
        };

        // sanitize records & determine other things :)
        const response = {
          casesMap: {},
          casesOrder: [],
          relationships: {},
          minGraphDate: null,
          maxGraphDate: null
        };
        (records || []).forEach((caseData) => {
          // sort addresses
          if (caseData.addresses) {
            caseData.addresses.sort((address1, address2) => {
              // compare missing dates & dates
              return compareDates(address1.date, address2.date);
            });
          }

          // transform relationships
          if (caseData.relationships) {
            // go through relationships and determine which can be added to our list
            (caseData.relationships || []).forEach((rel) => {
              // add to the list of relationships if both records are cases & our case is the source
              if (
                rel.persons.length > 1 &&
                rel.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' &&
                rel.persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' && (
                  ( rel.persons[0].source && rel.persons[0].id === caseData.id ) ||
                  ( rel.persons[1].source && rel.persons[1].id === caseData.id )
                )
              ) {
                // determine if we need to initialize the list of target cases for our source case
                if (!response.relationships[caseData.id]) {
                  response.relationships[caseData.id] = [];
                }

                // add to the list
                response.relationships[caseData.id].push(rel.persons[0].id === caseData.id ? rel.persons[1].id : rel.persons[0].id);
              }
            });

            // finished - case relationship data not needed anymore
            delete caseData.relationships;
          }

          // determine lastGraphDate
          // - should be the most recent date from case.dateOfOnset / case.dateRanges.endDate / case.labResults.dateSampleTaken
          caseData.lastGraphDate = moment(caseData.dateOfOnset);

          // determine firstGraphDate
          // - should be the oldest date from case.dateOfOnset / case.dateRanges.endDate / case.labResults.dateSampleTaken
          caseData.firstGraphDate = moment(caseData.dateOfOnset);

          // determine lastGraphDate starting with lab results
          if (caseData.labResults) {
            const labResults = caseData.labResults || [];
            caseData.labResults = [];
            labResults.forEach((lab) => {
              // ignore lab results without result date
              if (!lab.dateSampleTaken) {
                return;
              }

              // determine lastGraphDate
              const dateSampleTaken = moment(lab.dateSampleTaken);
              caseData.lastGraphDate = dateSampleTaken.isAfter(caseData.lastGraphDate) ?
                dateSampleTaken :
                caseData.lastGraphDate;

              // determine min graph date
              if (dateSampleTaken) {
                caseData.firstGraphDate = !caseData.firstGraphDate ?
                  dateSampleTaken : (
                    dateSampleTaken.isBefore(caseData.firstGraphDate) ?
                      dateSampleTaken :
                      caseData.firstGraphDate
                  );
              }

              // since we have dateSampleTaken, lets add it to the list
              caseData.labResults.push(lab);
            });
          }

          // check if there is a date range more recent
          if (caseData.dateRanges) {
            const dateRanges = caseData.dateRanges || [];
            caseData.dateRanges = [];
            dateRanges.forEach((dateRange) => {
              // ignore date range without at least one of the dates ( start / end )
              if (!dateRange.endDate && !dateRange.startDate) {
                return;
              }

              // make sure we have start date
              dateRange.startDate = dateRange.startDate ? moment(dateRange.startDate) : moment(caseData.dateOfOnset);

              // if we don't have an end date then we need to set the current date since this is still in progress
              dateRange.endDate = dateRange.endDate ? moment(dateRange.endDate) : moment();

              // determine min graph date
              if (dateRange.startDate) {
                caseData.firstGraphDate = !caseData.firstGraphDate ?
                  dateRange.startDate : (
                    dateRange.startDate.isBefore(caseData.firstGraphDate) ?
                      dateRange.startDate :
                      caseData.firstGraphDate
                  );
              }

              // determine last graph date
              caseData.lastGraphDate = dateRange.endDate.isAfter(caseData.lastGraphDate) ?
                dateRange.endDate :
                caseData.lastGraphDate;

              // since we have either start date or end date we can use it for the graph
              caseData.dateRanges.push(dateRange);
            });
          }

          // determine oldest onset date
          response.minGraphDate = !response.minGraphDate ?
            caseData.firstGraphDate : (
              caseData.firstGraphDate.isBefore(response.minGraphDate) ?
                caseData.firstGraphDate :
                response.minGraphDate
            );

          // determine the most recent case graph date
          response.maxGraphDate = !response.maxGraphDate ?
            caseData.lastGraphDate : (
              caseData.lastGraphDate.isAfter(response.maxGraphDate) ?
                caseData.lastGraphDate :
                response.maxGraphDate
            );

          // add response case
          delete caseData._id;
          response.casesMap[caseData.id] = caseData;
        });

        //sort cases
        response.casesOrder = Object
          .values(response.casesMap)
          .sort((case1, case2) => {
            // compare missing dates & dates
            return compareDates(case1.dateOfOnset, case2.dateOfOnset);
          })
          .map((caseData) => caseData.id);

        // return results
        return callback(
          null,
          response
        );
      })
      .catch(callback);
  };

  /**
   * Migrate data
   * @param callback
   */
  Case.migrate = (options, callback) => {
    // determine how many case we have so we can update them in batches
    helpers
      .migrateModelDataInBatches(
        Case,
        (modelData, cb) => {
          // check if we have questionnaire answer and is we need to update data
          if (
            !_.isEmpty(modelData.questionnaireAnswers) && (
              !_.isArray(modelData.questionnaireAnswers[Object.keys(modelData.questionnaireAnswers)[0]]) ||
              !_.isObject(modelData.questionnaireAnswers[Object.keys(modelData.questionnaireAnswers)[0]][0])
            )
          ) {
            // migrate questionnaire answers
            const newQuestionnaireAnswers = {};
            _.each(modelData.questionnaireAnswers, (value, variable) => {
              newQuestionnaireAnswers[variable] = [{
                value: value
              }];
            });

            // update case questionnaire answers
            modelData
              .updateAttributes({
                questionnaireAnswers: newQuestionnaireAnswers
              }, options)
              .catch(cb)
              .then(() => cb());
          } else {
            // finished
            cb();
          }
        }
      )
      .catch(callback)
      .then(() => {
        // finished
        callback();
      });
  };
};
