'use strict';

const _ = require('lodash');
const uuid = require('uuid');
const app = require('../../server/server');

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
    // id can have at most 1024 chars
    if (token.length > 900) {
      // make token smaller (and make sure its unique)
      token = `${token.substring(0, 100)}_${_.snakeCase(uuid.v4().toUpperCase())}`;
    }
    return `${token}_${_.snakeCase(languageId).toUpperCase()}`;
  };

  /**
   * On create, generate and add an ID to the language token instance
   */
  LanguageToken.observe('before save', function (context, next) {
    // update token sort key translation
    // used to sort by since token can be > 1024 bytes and it isn't possible at this moment to create an asc sort index on token key
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    if (data.source.all.token) {
      const tokenSortKey = data.source.all.token.substr(0, 128);
      if (tokenSortKey !== data.source.all.tokenSortKey) {
        data.target.tokenSortKey = tokenSortKey;
      }
    }

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
