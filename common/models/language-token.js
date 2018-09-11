'use strict';

const _ = require('lodash');

module.exports = function (LanguageToken) {
  // set flag to not get controller
  LanguageToken.hasController = false;

  /**
   * Generate Language token ID based on token and language ID
   * @param token
   * @param languageId
   * @returns {string}
   */
  LanguageToken.generateID = function (token, languageId) {
    return `${token}_${_.snakeCase(languageId).toUpperCase()}`;
  }
};
