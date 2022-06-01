'use strict';

const languageMigrator = require('../../languageMigrator');

/**
 * Create / Update language tokens
 */
const createUpdateLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(`${__dirname}/data/languages`)
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Create / Update only french language tokens
 */
const createUpdateSingleFrenchLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(
      `${__dirname}/data/french_single`, [
        'french_fr'
      ]
    )
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateLanguageTokens,
  createUpdateSingleFrenchLanguageTokens
};
