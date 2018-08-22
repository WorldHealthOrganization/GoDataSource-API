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
  Case.fieldLabelsMap = Object.assign({}, Case.fieldLabelsMap, {
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
    'isDateOfOnsetApproximate': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET_APPROXIMATE',
    'dateOfReporting': 'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CASE_FIELD_LABEL_DECEASED',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'isolationDates': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES',
    'hospitalizationDates': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES',
    'incubationDates': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES',
    'isolationDates[].startDate': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_START_DATE',
    'isolationDates[].endDate': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES_END_DATE',
    'hospitalizationDates[].startDate': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_START_DATE',
    'hospitalizationDates[].endDate': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES_END_DATE',
    'incubationDates[].startDate': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES_START_DATE',
    'incubationDates[].endDate': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES_END_DATE',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'addresses[].typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'addresses[].country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'addresses[].city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addresses[].addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addresses[].addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'addresses[].postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'addresses[].locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'addresses[].geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'visualId': 'LNG_CASE_FIELD_LABEL_VISUAL_ID',
    'fillGeoLocation': 'LNG_CASE_FIELD_LABEL_FILL_GEO_LOCATION',
    'isDateOfReportingApproximate': 'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE'
  });

  Case.referenceDataFieldsToCategoryMap = {
    classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPE'
  };

  Case.referenceDataFields = Object.keys(Case.referenceDataFieldsToCategoryMap);

  Case.extendedForm = {
    template: 'caseInvestigationTemplate',
    containerProperty: 'questionnaireAnswers'
  };

  Case.printFieldsinOrder = [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dob',
    'age',
    'occupation',
    'phoneNumber',
    'addresses',
    'documents',
    'type',
    'classification',
    'riskLevel',
    'riskReason',
    'dateBecomeCase',
    'dateDeceased',
    'dateOfInfection',
    'dateOfOnset',
    'dateOfOutcome',
    'hospitalizationDates',
    'incubationDates',
    'isolationDates',
    'transferRefused',
    'deceased'
  ];

  Case.foreignKeyResolverMap = {
    'addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    }
  };

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Case.nestedGeoPoints = [
    'addresses[].geoLocation'
  ];
};
