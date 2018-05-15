'use strict';
const _ = require('lodash');

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
   * Generate a language/translatable identified for a category + value combination
   * @param category
   * @param value
   * @return {string}
   */
  ReferenceData.getTranslatableIdentifierForValue = function (category, value) {
    return `${category}_${_.snakeCase(value).toUpperCase()}`;
  };

};
