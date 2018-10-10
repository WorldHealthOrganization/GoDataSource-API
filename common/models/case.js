'use strict';

const app = require('../../server/server');
const casesWorker = require('../../components/workerRunner').cases;
const _ = require('lodash');

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
    'hospitalizationDates[].startDate': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_START_DATE',
    'hospitalizationDates[].endDate': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_END_DATE',
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
      endDate = app.utils.helpers.getUTCDateEndOfDay(endDate);
    } else {
      // nothing sent, use current day's end of day
      endDate = app.utils.helpers.getUTCDateEndOfDay();
    }

    // define period interval
    const periodInterval = [
      outbreak.startDate,
      endDate
    ];

    // build period map
    const periodMap = app.utils.helpers.getChunksForInterval(periodInterval, periodType);

    // get available case classifications
    return app.models.referenceData
      .find({
        where: {
          categoryId: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION'
        }
      })
      .then(function (classifications) {
        const caseClassifications = {};
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
          .find(
            app.utils.remote
              .mergeFilters({
                where: {
                  outbreakId: outbreak.id,
                  dateOfOnset: {
                    lte: new Date(periodInterval[1])
                  }
                }
              })
          )
          .then(function (cases) {
            return new Promise(function (resolve, reject) {
              // count case classifications over time
              casesWorker.countStratifiedByClassificationOverTime(cases, periodInterval, periodType, periodMap, function (error, periodMap) {
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
};
