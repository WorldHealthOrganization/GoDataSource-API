'use strict';

module.exports = function (Case) {
  // set flag to not get controller
  Case.hasController = false;

  // list of case classifications that are not discarded
  Case.nonDiscardedCaseClassifications = [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED',
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_PROBABLE',
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_SUSPECT'
  ];

  // map language token labels for model properties
  Case.fieldLabelsMap = {
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
    'dateDeceased': 'LNG_CASE_FIELD_LABEL_DATE_DECEASED',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'dateOfReporting': 'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CASE_FIELD_LABEL_DECEASED'
  };

  Case.referenceDataFieldsToCategoryMap = {
    classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE'
  };

  Case.referenceDataFields = Object.keys(Case.referenceDataFieldsToCategoryMap);

  Case.extendedForm = {
    template: 'caseInvestigationTemplate',
    containerProperty: 'questionnaireAnswers'
  };
};
