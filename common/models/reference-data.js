'use strict';

const _ = require('lodash');
const app = require('../../server/server');

module.exports = function (ReferenceData) {

  // define available categories
  ReferenceData.availableCategories = [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
    'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
    'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
    'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
    'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'LNG_REFERENCE_DATA_CATEGORY_DISEASE',
    'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
    'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_INTENSITY',
    'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
    'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL',
    'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION',
    'LNG_REFERENCE_DATA_OUTCOME'
  ];

  /**
   * Keep a list of places where reference data might be used so we can safely delete a record
   * @type {{case: string[], contact: string[], outbreak: string[]}}
   */
  ReferenceData.possibleRecordUsage = {
    'case': ['document.type'],
    'contact': ['document.type'],
    'outbreak': ['caseClassification', 'vaccinationStatus', 'nutritionalStatus', 'pregnancyInformation']
  };

  /**
   * Get usage for a reference data
   * @param recordId
   * @param filter
   * @param justCount
   * @param callback
   */
  ReferenceData.findModelUsage = function (recordId, filter, justCount, callback) {
    const checkUsages = [];
    const modelNames = Object.keys(ReferenceData.possibleRecordUsage);
    // go through possible usage list
    modelNames.forEach(function (modelName) {
      const orQuery = [];
      // build a search query using the fields that might contain the information
      ReferenceData.possibleRecordUsage[modelName].forEach(function (field) {
        orQuery.push({[field]: recordId});
      });

      // build filter
      const _filter = app.utils.remote
        .mergeFilters({
          where: {
            or: orQuery
          }
        }, filter);

      // count/find the results
      if (justCount) {
        checkUsages.push(
          app.models[modelName].count(_filter.where)
        );
      } else {
        checkUsages.push(
          app.models[modelName].find(_filter)
        );
      }
    });
    Promise.all(checkUsages)
      .then(function (results) {
        // associate the results with the queried models
        const resultSet = {};
        results.forEach(function (result, index) {
          resultSet[modelNames[index]] = result;
        });
        callback(null, resultSet);
      })
      .catch(callback);
  };

  /**
   * Check if a record is in use
   * @param recordId
   * @param callback
   */
  ReferenceData.isRecordInUse = function (recordId, callback) {
    ReferenceData.findModelUsage(recordId, {}, true, function (error, results) {
      if (error) {
        return callback(error);
      }
      callback(null,
        // count all of the results, if > 0 then the record is used
        Object.values(results).reduce(function (a, b) {
          return a + b;
        }) > 0);
    });
  };

  /**
   * Check model usage before deleting the model
   */
  ReferenceData.observe('before delete', function (context, callback) {
    if (context.where.id) {
      ReferenceData.isRecordInUse(context.where.id, function (error, recordInUse) {
        if (error) {
          return callback(error);
        }
        // if the record is in use
        if (recordInUse) {
          // send back an error
          callback(app.utils.apiError.getError('MODEL_IN_USE', {model: ReferenceData.modelName, id: context.where.id}));
        } else {
          callback();
        }
      })
    } else {
      callback();
    }
  });
};
