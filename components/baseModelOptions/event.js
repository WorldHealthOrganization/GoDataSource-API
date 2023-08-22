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

  // set outbreak id
  formattedData.outbreakId = options.outbreakId;

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

module.exports = {
  helpers: {
    formatItemFromImportableFile,
    getAdditionalFormatOptions
  }
};
