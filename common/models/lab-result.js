'use strict';

module.exports = function (LabResult) {
  // set flag to not get controller
  LabResult.hasController = false;

  LabResult.referenceDataFieldsToCategoryMap = {
    labName: 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
    sampleType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
    testType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
    result: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
    status: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS'
  };

  LabResult.referenceDataFields = Object.keys(LabResult.referenceDataFieldsToCategoryMap);
};
