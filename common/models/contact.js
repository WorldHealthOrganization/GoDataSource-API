'use strict';

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

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
    'dateDeceased': 'LNG_CASE_FIELD_LABEL_DATE_DECEASED',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'deceased': 'LNG_CASE_FIELD_LABEL_DECEASED',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
  };

  Contact.printFieldsinOrder = [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'riskLevel',
    'riskReason',
    'occupation',
    'age',
    'dob',
    'phoneNumber',
    'type',
    'documents',
    'addresses',
    'deceased',
    'dateDeceased'
  ]
};
