'use strict';

const app = require('../../server/server');
const casesWorker = require('../../components/workerRunner').cases;
const _ = require('lodash');
const moment = require('moment');

module.exports = function (Case) {
  // set flag to not get controller
  Case.hasController = false;

  // list of case classifications that are discarded
  Case.discardedCaseClassifications = [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED'
  ];

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
    'dateDeceased': 'LNG_CASE_FIELD_LABEL_DATE_DECEASED',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'isDateOfOnsetApproximate': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET_APPROXIMATE',
    'dateOfReporting': 'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CASE_FIELD_LABEL_DECEASED',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'isolationDates': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES',
    'hospitalizationDates': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES',
    'incubationDates': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES',
    'isolationDates[].startDate': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_START_DATE',
    'isolationDates[].endDate': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_END_DATE',
    'isolationDates[].hospitalName': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_HOSPITAL_NAME',
    'isolationDates[].locationId': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_LOCATION',
    'isolationDates[].comments': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_COMMENTS',
    'hospitalizationDates[].startDate': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_START_DATE',
    'hospitalizationDates[].endDate': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_END_DATE',
    'hospitalizationDates[].hospitalName': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_HOSPITAL_NAME',
    'hospitalizationDates[].locationId': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_LOCATION',
    'hospitalizationDates[].comments': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_COMMENTS',
    'incubationDates[].startDate': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES_START_DATE',
    'incubationDates[].endDate': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES_END_DATE',
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
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'visualId': 'LNG_CASE_FIELD_LABEL_VISUAL_ID',
    'fillGeoLocation': 'LNG_CASE_FIELD_LABEL_FILL_GEO_LOCATION',
    'isDateOfReportingApproximate': 'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'questionnaireAnswers': 'LNG_PAGE_CREATE_FOLLOW_UP_TAB_QUESTIONNAIRE_TITLE',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL'
  });

  Case.referenceDataFieldsToCategoryMap = {
    classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE'
  };

  Case.referenceDataFields = Object.keys(Case.referenceDataFieldsToCategoryMap);

  Case.extendedForm = {
    template: 'caseInvestigationTemplate',
    containerProperty: 'questionnaireAnswers'
  };

  Case.printFieldsinOrder = [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dob',
    'age',
    'occupation',
    'phoneNumber',
    'addresses',
    'documents',
    'type',
    'classification',
    'riskLevel',
    'riskReason',
    'wasContact',
    'dateBecomeCase',
    'dateDeceased',
    'dateOfInfection',
    'dateOfOnset',
    'dateOfOutcome',
    'hospitalizationDates',
    'incubationDates',
    'isolationDates',
    'transferRefused',
    'deceased',
    'safeBurial'
  ];

  Case.foreignKeyResolverMap = {
    'addresses[].locationId': {
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
    next();
  });

  /**
   * Count cases stratified by classification over time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByClassificationOverTime = function (outbreak, filter) {
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

    // get available case classifications
    const caseClassifications = {};
    return app.models.referenceData
      .find({
        where: {
          categoryId: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION'
        }
      })
      .then(function (classifications) {
        // add default entries for all classifications
        classifications.forEach(function (classification) {
          caseClassifications[classification.id] = 0;
        });
        // add case classifications to periodMap
        Object.keys(periodMap)
          .forEach(function (periodMapIndex) {
            Object.assign(periodMap[periodMapIndex], {
              classification: caseClassifications,
              total: 0
            });
          });
      })
      .then(function () {
        // find cases that have date of onset earlier then end of the period interval
        return app.models.case
          .rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(
              app.utils.remote.mergeFilters({
                where: {
                  outbreakId: outbreak.id,
                  dateOfOnset: {
                    lte: new Date(periodInterval[1])
                  }
                }
              }, filter || {}).where
            )
          )
          .then(function (cases) {
            return new Promise(function (resolve, reject) {
              // count case classifications over time
              casesWorker.countStratifiedByClassificationOverTime(cases, periodInterval, periodType, periodMap, caseClassifications, function (error, periodMap) {
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
              // only keep the first one for each person
              if (!labResultsMap[labResult.personId]) {
                labResultsMap[labResult.personId] = labResult;
              }
            });

            // build the list of results
            const results = [];
            // go through case records
            cases.forEach(function (caseRecord) {

              // get lab result's dateSampleTaken, if available
              const labResultDate = labResultsMap[caseRecord.id] ? labResultsMap[caseRecord.id].dateSampleTaken : null;
              // build each result
              const result = {
                dateOfOnset: caseRecord.dateOfOnset,
                dateOfFirstLabTest: labResultDate,
                delay: null,
                case: caseRecord
              };
              // calculate delay if both dates are available (onset is ensured by the query)
              if (labResultDate) {
                const onset = moment(result.dateOfOnset);
                const labTest = moment(result.dateOfFirstLabTest);
                result.delay = labTest.diff(onset, 'days');
              }
              results.push(result);
            });
            // return the list of results
            return results;
          });
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
};
