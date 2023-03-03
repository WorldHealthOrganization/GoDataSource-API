'use strict';

const MongoDBHelper = require('./../mongoDBHelper');
const mergeFilters = require('./../mergeFilters');
const convertLoopbackFilterToMongo = require('./../convertLoopbackFilterToMongo');
const helpers = require('./../helpers');

/**
 * TODO: Duplicated from Outbreak model; doesn't use Loopback models. Should be used in Outbreak model
 * Retrieve list of system reference data and outbreak's specific reference data; Returns the promise
 * @param outbreakId
 * @param filter Optional additional filter for the reference data
 */
const getSystemAndOutbreakReferenceData = function (outbreakId, filter) {
  // no scope query for reference data
  const loopbackFilter = mergeFilters(
    {
      where: {
        or: [
          {
            outbreakId: {
              eq: null
            }
          },
          {
            outbreakId: outbreakId
          }
        ],
        // add not deleted filter
        deleted: false
      }
    },
    filter
  );

  const query = convertLoopbackFilterToMongo(loopbackFilter.where);

  let projection;
  if (loopbackFilter.fields) {
    projection = {};
    loopbackFilter.fields.forEach(field => {
      projection[field] = 1;
    });
  }

  return MongoDBHelper.executeAction(
    'referenceData',
    'find',
    [
      query,
      {
        projection: projection
      }
    ]);
};

/**
 * Add additional formatting options; To be done once per import process
 * @param {Object} options - Options for formatting
 */
const getAdditionalFormatOptions = function (options) {
  options.processedMap = helpers.processMapLists(options.map);
};

/**
 * Format relationship imported data
 * @param {Object} item - Item to process
 * @param {Array} formattedDataContainer - Container for formatted data
 * @param {Object} options - Options for processing
 * returns {Promise<unknown>}
 */
const formatItemFromImportableFile = function (item, formattedDataContainer, options) {
  // remap properties
  const remappedProperties = helpers.remapPropertiesUsingProcessedMap([item], options.processedMap, options.valuesMap)[0];

  // process boolean values
  let formattedData = helpers.convertPropertiesNoModelByType(
    options.modelBooleanProperties || [],
    remappedProperties,
    helpers.DATA_TYPE.BOOLEAN
  );

  // process date values
  formattedData = helpers.convertPropertiesNoModelByType(
    options.modelDateProperties || [],
    formattedData,
    helpers.DATA_TYPE.DATE
  );

  // add relationship entry in the processed list
  formattedDataContainer.push({
    raw: item,
    save: formattedData
  });
};

module.exports = {
  helpers: {
    getSystemAndOutbreakReferenceData,
    formatItemFromImportableFile,
    getAdditionalFormatOptions
  }
};
