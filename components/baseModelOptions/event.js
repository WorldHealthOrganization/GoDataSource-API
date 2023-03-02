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
 * Format event imported data
 * @param {Object} item - Item to process
 * @param {Array} formattedDataContainer - Container for formatted data
 * @param {Object} options - Options for processing
 * returns {Promise<unknown>}
 */
const formatItemFromImportableFile = function (item, formattedDataContainer, options) {
  // remap properties
  const remappedProperties = helpers.remapPropertiesUsingProcessedMap([item], options.processedMap, options.valuesMap);

  // process boolean values
  let formattedDataMap = helpers.convertPropertiesNoModelByType(
    options.modelBooleanProperties || [],
    remappedProperties,
    helpers.DATA_TYPE.BOOLEAN
  );

  // process date values
  formattedDataMap = helpers.convertPropertiesNoModelByType(
    options.modelDateProperties || [],
    formattedDataMap,
    helpers.DATA_TYPE.DATE
  );

  // get the formatted record
  const formattedData = formattedDataMap[0];

  // set outbreak id
  formattedData.outbreakId = options.outbreakId;

  // add case entry in the processed list
  formattedDataContainer.push({
    raw: item,
    save: formattedData
  });
};

module.exports = {
  helpers: {
    formatItemFromImportableFile,
    getAdditionalFormatOptions
  }
};
