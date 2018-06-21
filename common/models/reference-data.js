'use strict';

const _ = require('lodash');
const app = require('../../server/server');

module.exports = function (ReferenceData) {

  // define available categories
  ReferenceData.availableCategories = [
    [
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION",
        "description": "LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_GENDER",
        "description": "LNG_REFERENCE_DATA_CATEGORY_GENDER_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_OCCUPATION",
        "description": "LNG_REFERENCE_DATA_CATEGORY_OCCUPATION_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_LAB_NAME",
        "description": "LNG_REFERENCE_DATA_CATEGORY_LAB_NAME_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE",
        "description": "LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST",
        "description": "LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT",
        "description": "LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE",
        "description": "LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_DISEASE",
        "description": "LNG_REFERENCE_DATA_CATEGORY_DISEASE_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE",
        "description": "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_INTENSITY",
        "description": "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_INTENSITY_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY",
        "description": "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL",
        "description": "LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL",
        "description": "LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION",
        "description": "LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION_DESCRIPTION"
      },
      {
        "id": "LNG_REFERENCE_DATA_OUTCOME",
        "description": "LNG_REFERENCE_DATA_OUTCOME_DESCRIPTION"
      }
    ]
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
   * Generate a language/translatable identifier for a category + value combination
   * @param category
   * @param value
   * @return {string}
   */
  ReferenceData.getTranslatableIdentifierForValue = function (category, value) {
    return `${category}_${_.snakeCase(value).toUpperCase()}`;
  };

  /**
   * Check if an entry is editable (!readOnly + !inUse)
   * @param referenceData|referenceDataId
   * @param callback
   * @return {*}
   */
  ReferenceData.isEntryEditable = function (referenceData, callback) {
    let referenceDataId;

    /**
     * Check if a writable model is in use
     * @param error
     * @param writable
     * @return {*}
     */
    function _callback(error, writable) {
      if (error) {
        return callback(error);
      }
      // if it's not writable, stop here
      if (!writable) {
        return callback(app.utils.apiError.getError('MODEL_NOT_EDITABLE', {
          model: ReferenceData.modelName,
          id: referenceDataId
        }));
      }
      // record is writable, check usage
      ReferenceData.isRecordInUse(referenceDataId, function (error, recordInUse) {
        if (error) {
          return callback(error);
        }
        // record in use
        if (recordInUse) {
          // send back an error
          return callback(app.utils.apiError.getError('MODEL_IN_USE', {
            model: ReferenceData.modelName,
            id: referenceDataId
          }));
        }
        return callback(null, true);
      });
    }

    // if this a reference data item, check readOnly field
    if (typeof referenceData === 'object') {
      referenceDataId = referenceData.id;
      // then check usage
      return _callback(null, !referenceData.readOnly);
    }
    // this is only an ID, find the actual record and check if it's writable
    ReferenceData.findById(referenceData)
      .then(function (referenceData) {
        referenceDataId = referenceData.id;
        let editable = true;
        if (!referenceData || referenceData.readOnly) {
          editable = false
        }
        //then check usage
        _callback(null, editable);
      })
      .catch(_callback);
  };
};
