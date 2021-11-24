'use strict';

const async = require('async');
const personConstants = require('./person');
const helpers = require('./../helpers');

// constants
const constants = {
  arrayProps: {
    dateRanges: {
      'typeId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_TYPE_ID',
      'startDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_START_DATE',
      'endDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_END_DATE',
      'centerName': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_CENTER_NAME',
      'locationId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_LOCATION',
      'comments': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_COMMENTS',
    },
    addresses: {
      'typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
      'country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
      'city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
      'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
      'postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
      'locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
      'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
      'geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
      'geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
      'geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
      'date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
      'phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
      'emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS'
    },
    documents: {
      'type': 'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
      'number': 'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER'
    },
    vaccinesReceived: {
      'vaccine': 'LNG_CASE_FIELD_LABEL_VACCINE',
      'date': 'LNG_CASE_FIELD_LABEL_VACCINE_DATE',
      'status': 'LNG_CASE_FIELD_LABEL_VACCINE_STATUS',
    }
  },
  discardedCaseClassifications: [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED'
  ],
  exportFieldsOrder: [
    'id',
    'visualId',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ],
  // map language token labels for model properties
  fieldLabelsMap: Object.assign({}, personConstants.constants.fieldLabelsMap, {
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
    'dateBecomeCase': 'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
    'wasContact': 'LNG_CASE_FIELD_LABEL_WAS_CONTACT',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'isDateOfOnsetApproximate': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET_APPROXIMATE',
    'dateOfReporting': 'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'numberOfExposures': 'LNG_CASE_FIELD_LABEL_NUMBER_OF_EXPOSURES',
    'numberOfContacts': 'LNG_CASE_FIELD_LABEL_NUMBER_OF_CONTACTS',
    'dateRanges': 'LNG_CASE_FIELD_LABEL_DATE_RANGES',
    'dateRanges[].typeId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_TYPE_ID',
    'dateRanges[].startDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_START_DATE',
    'dateRanges[].endDate': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_END_DATE',
    'dateRanges[].centerName': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_CENTER_NAME',
    'dateRanges[].locationId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_LOCATION',
    'dateRanges[].comments': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_COMMENTS',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'documents[].type': 'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'addresses[].typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'addresses[].country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'addresses[].city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addresses[].addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addresses[].postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'addresses[].locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'addresses[].geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'addresses[].geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'addresses[].geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'addresses[].geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'addresses[].phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'addresses[].emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS',
    'visualId': 'LNG_CASE_FIELD_LABEL_VISUAL_ID',
    'isDateOfReportingApproximate': 'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CASE_FIELD_LABEL_DATE_OF_BURIAL',
    'burialLocationId': 'LNG_CASE_FIELD_LABEL_BURIAL_LOCATION_ID',
    'burialPlaceName': 'LNG_CASE_FIELD_LABEL_BURIAL_PLACE_NAME',
    'vaccinesReceived': 'LNG_CASE_FIELD_LABEL_VACCINES_RECEIVED',
    'vaccinesReceived[].vaccine': 'LNG_CASE_FIELD_LABEL_VACCINE',
    'vaccinesReceived[].date': 'LNG_CASE_FIELD_LABEL_VACCINE_DATE',
    'vaccinesReceived[].status': 'LNG_CASE_FIELD_LABEL_VACCINE_STATUS',
    'pregnancyStatus': 'LNG_CASE_FIELD_LABEL_PREGNANCY_STATUS',
    'responsibleUserId': 'LNG_CASE_FIELD_LABEL_RESPONSIBLE_USER_ID',

    // must be last item from the list
    'questionnaireAnswers': 'LNG_CASE_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  }),
  foreignKeyResolverMap: {
    'burialLocationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    },
    'addresses[].locationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    },
    'dateRanges[].locationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    },
    'relationships[].clusterId': {
      modelName: 'cluster',
      collectionName: 'cluster',
      useProperty: 'name'
    },
    'relationships[].people[].addresses[].locationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].address.locationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].burialLocationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].dateRanges[].locationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    }
  },
  locationFields: [
    'addresses[].locationId',
    'dateRanges[].locationId',
    'burialLocationId'
  ],
  referenceDataFieldsToCategoryMap: {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    'dateRanges[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE',
    'dateRanges[].centerName': 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME',
    'vaccinesReceived[].vaccine': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
    'vaccinesReceived[].status': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
    pregnancyStatus: 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS'
  },
  get referenceDataFields() {
    return Object.keys(this.referenceDataFieldsToCategoryMap);
  }
};

const formatItemFromImportableFile = function (item, formattedDataContainer, options) {
  // remap properties
  const remappedProperties = helpers.remapPropertiesUsingProcessedMap([item], options.processedMap, options.valuesMap);

  // process boolean values
  const formattedData = helpers.convertBooleanPropertiesNoModel(
    options.modelBooleanProperties || [],
    remappedProperties)[0];

  // set outbreak id
  formattedData.outbreakId = options.outbreakId;

  // filter out empty addresses
  const addresses = helpers.sanitizePersonAddresses(formattedData);
  if (addresses) {
    formattedData.addresses = addresses;
  }

  // sanitize questionnaire answers
  if (formattedData.questionnaireAnswers) {
    // convert properties that should be date to actual date objects
    formattedData.questionnaireAnswers = helpers.convertQuestionnairePropsToDate(formattedData.questionnaireAnswers);
  }

  // sanitize visual ID
  if (formattedData.visualId) {
    formattedData.visualId = helpers.sanitizePersonVisualId(formattedData.visualId);
  }

  // add case entry in the processed list
  formattedDataContainer.push({
    raw: item,
    save: formattedData
  });
};

const getAdditionalFormatOptions = function (options) {
  options.processedMap = helpers.processMapLists(options.map);
};

/**
 * Format cases imported data
 * @param {Array} rawData - List of items to process
 * @param {Array} formattedDataContainer - Container for formatted data
 * @param {Object} options - Options for processing
 * returns {Promise<unknown>}
 */
const formatDataFromImportableFile = function (rawData, formattedDataContainer, options) {
  // !processedMap && (processedMap = helpers.processMapLists(options.map));
  if (!formatDataFromImportableFile.processedMap) {
    formatDataFromImportableFile.processedMap = helpers.processMapLists(options.map);
  }

  return new Promise((resolve, reject) => {
    async.eachSeries(
      rawData,
      (rawItem, callback) => {
        // run the code async in order to allow sending processed items to parent while still processing other items
        setTimeout(() => {
          // remap properties
          const remappedProperties = helpers.remapPropertiesUsingProcessedMap([rawItem], formatDataFromImportableFile.processedMap, options.valuesMap);

          // process boolean values
          const formattedData = helpers.convertBooleanPropertiesNoModel(
            options.modelBooleanProperties || [],
            remappedProperties)[0];

          // set outbreak id
          formattedData.outbreakId = options.outbreakId;

          // filter out empty addresses
          const addresses = helpers.sanitizePersonAddresses(formattedData);
          if (addresses) {
            formattedData.addresses = addresses;
          }

          // sanitize questionnaire answers
          if (formattedData.questionnaireAnswers) {
            // convert properties that should be date to actual date objects
            formattedData.questionnaireAnswers = helpers.convertQuestionnairePropsToDate(formattedData.questionnaireAnswers);
          }

          // sanitize visual ID
          if (formattedData.visualId) {
            formattedData.visualId = helpers.sanitizePersonVisualId(formattedData.visualId);
          }

          // add case entry in the processed list
          formattedDataContainer.push({
            raw: rawItem,
            save: formattedData
          });

          callback();
        }, 0);
      }, err => {
        if (err) {
          return reject(err);
        }

        resolve();
      });
  });
};

module.exports = {
  constants: constants,
  helpers: {
    formatDataFromImportableFile,
    formatItemFromImportableFile,
    getAdditionalFormatOptions
  }
};
