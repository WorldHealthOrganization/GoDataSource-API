'use strict';

const referenceDataMigrator = require('../../referenceDataMigrator');

/**
 * Create / Update default reference data
 */
const createUpdateDefaultReferenceData = (callback) => {
  referenceDataMigrator
    .createUpdateDefaultReferenceData(`${__dirname}/data/reference`)
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateDefaultReferenceData
};
