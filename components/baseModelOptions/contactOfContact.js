'use strict';

const async = require('async');
const helpers = require('./../helpers');

/**
 * Format contact imported data
 * @param {Array} rawData - List of items to process
 * @param {Array} formattedDataContainer - Container for formatted data
 * @param {Object} options - Options for processing
 * returns {Promise<unknown>}
 */
const formatDataFromImportableFile = function (rawData, formattedDataContainer, options) {
  const processedMap = helpers.processMapLists(options.map);

  return new Promise((resolve, reject) => {
    async.eachSeries(
      rawData,
      (rawItem, callback) => {
        // run the code async in order to allow sending processed items to parent while still processing other items
        setTimeout(() => {
          // remap properties
          const remappedProperties = helpers.remapPropertiesUsingProcessedMap([rawItem], processedMap, options.valuesMap)[0];

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
            raw: rawItem,
            save: {
              contactOfContact: formattedContactOfContactData,
              relationship: formattedRelationshipData
            }
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
  helpers: {
    formatDataFromImportableFile: formatDataFromImportableFile
  }
};
