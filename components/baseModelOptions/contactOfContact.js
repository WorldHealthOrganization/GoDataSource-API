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
 * Format contact of contact imported data
 * @param {Object} item - Item to process
 * @param {Array} formattedDataContainer - Container for formatted data
 * @param {Object} options - Options for processing
 * returns {Promise<unknown>}
 */
const formatItemFromImportableFile = function (item, formattedDataContainer, options) {
  // remap properties
  const remappedProperties = helpers.remapPropertiesUsingProcessedMap([item], options.processedMap, options.valuesMap)[0];

  // process boolean values
  const formattedRelationshipData = helpers.convertBooleanPropertiesNoModel(
    options.relationshipModelBooleanProperties || [],
    helpers.extractImportableFieldsNoModel(options.relationshipImportableTopLevelProperties, remappedProperties.relationship));

  const formattedContactOfContactData = helpers.convertBooleanPropertiesNoModel(
    options.contactOfContactModelBooleanProperties || [],
    helpers.extractImportableFieldsNoModel(options.contactOfContactImportableTopLevelProperties, remappedProperties));

  // set outbreak id
  formattedRelationshipData.outbreakId = options.outbreakId;
  formattedContactOfContactData.outbreakId = options.outbreakId;

  // filter out empty addresses
  const addresses = helpers.sanitizePersonAddresses(formattedContactOfContactData);
  if (addresses) {
    formattedContactOfContactData.addresses = addresses;
  }

  // sanitize visual ID
  if (formattedContactOfContactData.visualId) {
    formattedContactOfContactData.visualId = helpers.sanitizePersonVisualId(formattedContactOfContactData.visualId);
  }

  // add contact entry in the processed list
  formattedDataContainer.push({
    raw: item,
    save: {
      contactOfContact: formattedContactOfContactData,
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
