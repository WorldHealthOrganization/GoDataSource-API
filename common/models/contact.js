'use strict';

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

  Contact.fieldLabelsMap = Object.assign({}, Contact.fieldLabelsMap, {
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
    'visualId': 'LNG_CONTACT_FIELD_LABEL_VISUAL_ID',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'addresses[].name': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_NAME',
    'addresses[].country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'addresses[].city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addresses[].addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addresses[].addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'addresses[].postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'addresses[].locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'addresses[].geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'fillGeoLocation': 'LNG_CONTACT_FIELD_LABEL_FILL_GEO_LOCATION',
    'isDateOfReportingApproximate': 'LNG_CONTACT_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE'
  });

  Contact.referenceDataFieldsToCategoryMap = {
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    'documents.type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE'
  };

  Contact.referenceDataFields = Object.keys(Contact.referenceDataFieldsToCategoryMap);
};
