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
  };

  /**
   * On create, generate and add an ID to the language token instance
   */
  LanguageToken.observe('before save', function (context, next) {
    // do not execute hook on sync
    if (context.options && context.options._sync) {
      return next();
    }

    // we are interested only on new instances
    if (!context.isNewInstance) {
      return next();
    }

    // set ID
    context.instance.id = LanguageToken.generateID(context.instance.token, context.instance.languageId);
    next();
  });
};
