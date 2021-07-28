'use strict';

const async = require('async');
const helpers = require('./../helpers');

/**
 * Format cases imported data
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
          const remappedProperties = helpers.remapPropertiesUsingProcessedMap([rawItem], processedMap, options.valuesMap);

          // process boolean values
          const formattedData = helpers.convertBooleanPropertiesNoModel(
            options.modelBooleanProperties || [],
            remappedProperties)[0];

          // set outbreak id
          formattedData.outbreakId = options.outbreakId;

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
  helpers: {
    formatDataFromImportableFile: formatDataFromImportableFile
  }
};
