'use strict';

module.exports = function (Labresult) {
  // set flag to not get controller
  Labresult.hasController = false;

  Labresult.fieldLabelsMap = {
    'dateSampleTaken': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_TAKEN',
    'dateSampleDelivered': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_DELIVERED',
    'dateTesting': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_TESTNG',
    'dateOfResult': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_OF_RESULT',
    'labName': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_LAB_NAME',
    'sampleType': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_SAMPLE_TYPE',
    'testType': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_TEST_TYPE',
    'result': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_RESULT',
    'quantitativeResult': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_QUANTITATIVE_RESULT',
    'notes': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_NOTES',
    'status': 'LNG_CASE_LAB_RESULT_FIELD_LABEL_STATUS'
  };

  Labresult.referenceDataFields = [
    'status',
    'labName',
    'sampleType',
    'testType',
    'result',
  ];
};
