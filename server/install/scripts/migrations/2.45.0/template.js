'use strict';

const templateMigrator = require('../../templateMigrator');

/**
 * Create / Update default outbreak templates
 */
const createUpdateDefaultOutbreakTemplates = (callback) => {
  templateMigrator
    .createUpdateDefaultOutbreakTemplates(`${__dirname}/data/templates`)
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateDefaultOutbreakTemplates
};
