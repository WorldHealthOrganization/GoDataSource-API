'use strict';

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

  Contact.fieldLabelsMap = {
    'firstName': 'LNG_CONTACT_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CONTACT_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CONTACT_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CONTACT_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CONTACT_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CONTACT_FIELD_LABEL_AGE',
    'dob': 'LNG_CONTACT_FIELD_LABEL_DOB',
    'documents[].type': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER',
    'dateDeceased': 'LNG_CONTACT_FIELD_LABEL_DATE_DECEASED',
    'dateOfReporting': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_REPORTING',
    'phoneNumber': 'LNG_CONTACT_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CONTACT_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CONTACT_FIELD_LABEL_RISK_REASON',
    'dateOfOutcome': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CONTACT_FIELD_LABEL_DECEASED',
  };

  Contact.referenceDataFieldsToCategoryMap = {
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    'documents.type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE'
  };

  Contact.referenceDataFields = Object.keys(Contact.referenceDataFieldsToCategoryMap);

  // map language token labels for model properties
  Contact.fieldLabelsMap = {
    'firstName': 'LNG_CASE_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CASE_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CASE_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CASE_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CASE_FIELD_LABEL_AGE',
    'dob': 'LNG_CASE_FIELD_LABEL_DOB',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON'
  };
};
