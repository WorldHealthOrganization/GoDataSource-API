'use strict';

const extendedPersistedModelConstants = require('./extendedPersistedModel');

const constants = {
  fieldLabelsMap: Object.assign({}, extendedPersistedModelConstants.constants.fieldLabelsMap, {
    'firstName': 'LNG_CASE_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CASE_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CASE_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CASE_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CASE_FIELD_LABEL_AGE',
    'age.years': 'LNG_CASE_FIELD_LABEL_AGE_YEARS',
    'age.months': 'LNG_CASE_FIELD_LABEL_AGE_MONTHS',
    'dob': 'LNG_CASE_FIELD_LABEL_DOB',
    'classification': 'LNG_CASE_FIELD_LABEL_CLASSIFICATION',
    'wasCase': 'LNG_CONTACT_FIELD_LABEL_WAS_CASE',
    'dateBecomeCase': 'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
    'wasContact': 'LNG_CASE_FIELD_LABEL_WAS_CONTACT',
    'dateBecomeContact': 'LNG_CONTACT_FIELD_LABEL_DATE_BECOME_CONTACT',
    'wasContactOfContact': 'LNG_CONTACT_FIELD_LABEL_WAS_CONTACT_OF_CONTACT',
    'dateBecomeContactOfContact': 'LNG_CONTACT_FIELD_LABEL_DATE_BECOME_CONTACT_OF_CONTACT',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'dateRanges': 'LNG_CASE_FIELD_LABEL_DATE_RANGES',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CASE_FIELD_LABEL_DATE_OF_BURIAL'
  })
};

module.exports = {
  constants: constants
};
