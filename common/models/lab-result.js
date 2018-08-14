'use strict';

module.exports = function (LabResult) {
  // set flag to not get controller
  LabResult.hasController = false;

  LabResult.fieldLabelsMap = Object.assign({}, LabResult.fieldLabelsMap, {
    personId: "LNG_CASE_LAB_RESULT_FIELD_LABEL_PERSON_ID",
    dateSampleTaken: "LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_TAKEN",
    dateSampleDelivered: "LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_DELIVERED",
    dateTesting: "LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_TESTING",
    dateOfResult: "LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_OF_RESULT",
    labName: "LNG_CASE_LAB_RESULT_FIELD_LABEL_LAB_NAME",
    sampleIdentifier: "LNG_CASE_LAB_RESULT_FIELD_LABEL_ID",
    sampleType: "LNG_CASE_LAB_RESULT_FIELD_LABEL_SAMPLE_TYPE",
    testType: "LNG_CASE_LAB_RESULT_FIELD_LABEL_TEST_TYPE",
    result: "LNG_CASE_LAB_RESULT_FIELD_LABEL_RESULT",
    quantitativeResult: "LNG_CASE_LAB_RESULT_FIELD_LABEL_QUANTITATIVE_RESULT",
    notes: "LNG_CASE_LAB_RESULT_FIELD_LABEL_NOTES",
    status: "LNG_CASE_LAB_RESULT_FIELD_LABEL_STATUS"
  });

  LabResult.referenceDataFieldsToCategoryMap = {
    labName: 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
    sampleType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
    testType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
    result: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
    status: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS'
  };

  LabResult.referenceDataFields = Object.keys(LabResult.referenceDataFieldsToCategoryMap);

  LabResult.extendedForm = {
    template: 'labResultsTemplate',
    containerProperty: 'questionnaireAnswers'
  };
};
