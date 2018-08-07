'use strict';

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

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
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES'
  };

  Contact.referenceDataFields = [
    'gender',
    'riskLevel',
    'occupation',
    'documents.type'
  ];
};
