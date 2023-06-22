'use strict';

const helpers = require('./../helpers');

/**
 * Add additional formatting options; To be done once per import process
 * @param {Object} options - Options for formatting
 */
const getAdditionalFormatOptions = function (options) {
  options.processedMap = helpers.processMapLists(options.map);
};

/**
 * Format contact imported data
 * @param {Object} item - Item to process
 * @param {Array} formattedDataContainer - Container for formatted data
 * @param {Object} options - Options for processing
 * returns {Promise<unknown>}
 */
const formatItemFromImportableFile = function (item, formattedDataContainer, options) {
  // remap properties
  const remappedProperties = helpers.remapPropertiesUsingProcessedMap([item], options.processedMap, options.valuesMap)[0];

  // process boolean values
  let formattedRelationshipData = helpers.convertPropertiesNoModelByType(
    options.relationshipModelBooleanProperties || [],
    helpers.extractImportableFieldsNoModel(options.relationshipImportableTopLevelProperties, remappedProperties.relationship),
    helpers.DATA_TYPE.BOOLEAN
  );

  let formattedContactData = helpers.convertPropertiesNoModelByType(
    options.contactModelBooleanProperties || [],
    helpers.extractImportableFieldsNoModel(options.contactImportableTopLevelProperties, remappedProperties),
    helpers.DATA_TYPE.BOOLEAN
  );

  // process date values
  formattedRelationshipData = helpers.convertPropertiesNoModelByType(
    options.relationshipModelDateProperties || [],
    formattedRelationshipData,
    helpers.DATA_TYPE.DATE
  );

  formattedContactData = helpers.convertPropertiesNoModelByType(
    options.contactModelDateProperties || [],
    formattedContactData,
    helpers.DATA_TYPE.DATE
  );

  // set outbreak id
  formattedRelationshipData.outbreakId = options.outbreakId;
  formattedContactData.outbreakId = options.outbreakId;

  // filter out empty addresses
  const addresses = helpers.sanitizePersonAddresses(formattedContactData);
  if (addresses) {
    formattedContactData.addresses = addresses;
  }

  // sanitize questionnaire answers
  if (formattedContactData.questionnaireAnswers) {
    // convert properties that should be date to actual date objects
    formattedContactData.questionnaireAnswers = helpers.convertQuestionnairePropsToDate(formattedContactData.questionnaireAnswers);
  }

  // sanitize visual ID
  if (formattedContactData.visualId) {
    formattedContactData.visualId = helpers.sanitizePersonVisualId(formattedContactData.visualId);
  }

  // add contact entry in the processed list
  formattedDataContainer.push({
    raw: item,
    save: {
      contact: formattedContactData,
      relationship: formattedRelationshipData
    }
  });
};

module.exports = {
  helpers: {
    formatItemFromImportableFile,
    getAdditionalFormatOptions
  }
};
