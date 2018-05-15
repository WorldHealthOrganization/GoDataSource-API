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
    'LNG_REFERENCE_DATA_CATEGORY_STATUS',
    'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
    'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_INTENSITY',
    'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
    'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL',
    'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION'
  ];

  /**
   * Keep a list od places where reference data might be used so we can safely delete a record
   * @type {{case: string[], contact: string[], outbreak: string[]}}
   */
  ReferenceData.possibleRecordUsage = {
    'case': ['document.type'],
    'contact': ['document.type'],
    'outbreak': ['caseClassification', 'vaccinationStatus', 'nutritionalStatus', 'pregnancyInformation']
  };

  /**
   * Check if a record is in use by checking all possible locations for usage
   * @param recordId
   * @param callback
   */
  ReferenceData.isRecordInUse = function (recordId, callback) {
    const checkUsages = [];
    // go through possible usage list
    Object.keys(ReferenceData.possibleRecordUsage).forEach(function (modelName) {
      const orQuery = [];
      // build a search query using the fields that might contain the information
      ReferenceData.possibleRecordUsage[modelName].forEach(function (field) {
        orQuery.push({[field]: recordId});
      });
      // count the results
      checkUsages.push(
        app.models[modelName].count({or: orQuery})
      );
    });
    Promise.all(checkUsages)
      .then(function (results) {
        callback(null,
          // count all of the results, if > 0 then the record is used
          results.reduce(function (a, b) {
            return a + b;
          }) > 0);
      })
      .catch(callback);
  };

  /**
   * Generate a language/translatable identifier for a category + value combination
   * @param category
   * @param value
   * @return {string}
   */
  ReferenceData.getTranslatableIdentifierForValue = function (category, value) {
    return `${category}_${_.snakeCase(value).toUpperCase()}`;
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
