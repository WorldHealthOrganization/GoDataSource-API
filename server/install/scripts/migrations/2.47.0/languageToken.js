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
 * Create / Update only english language tokens
 */
const createUpdateSingleEnglishLanguageTokens = (callback) => {
  languageMigrator
    .createUpdateLanguageTokens(
      `${__dirname}/data/english_single`, [
        'english_us'
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
  createUpdateSingleEnglishLanguageTokens
};
