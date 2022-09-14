'use strict';

const languageMigrator = require('../../languageMigrator');
const removeDuplicateLanguageTokens = require('../../removeDuplicateLanguageTokens');
const addMissingLanguageTokens = require('../../addMissingLanguageTokens');

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
 * Check and remove duplicate tokens
 */
const checkAndRemoveLanguageTokens = (callback) => {
  removeDuplicateLanguageTokens.checkAndRemoveLanguageTokens(callback);
};

/**
 * Add missing language tokens
 */
const checkAndAddMissingLanguageTokens = (callback) => {
  addMissingLanguageTokens.checkAndAddMissingLanguageTokens(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  createUpdateLanguageTokens,
  checkAndRemoveLanguageTokens,
  checkAndAddMissingLanguageTokens
};
