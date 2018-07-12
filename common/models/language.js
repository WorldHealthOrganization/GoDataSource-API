'use strict';

const app = require('../../server/server');
const async = require('async');

module.exports = function (Language) {

  /**
   * Update translations for a language
   * @param languageTokens [{token: 'string', translation: 'string'}]
   * @param options
   * @return {Promise<any>} list of created/updated records
   */
  Language.prototype.updateLanguageTranslations = function (languageTokens, options) {
    // make context available
    const self = this;
    // keep a list of language tokens to be created/updated
    const createLanguageTokens = [];
    // method uses promises
    return new Promise(function (resolve, reject) {
      // for each language token
      languageTokens.forEach(function (languageToken) {
        // create/update token for language
        createLanguageTokens.push(function (callback) {
          // try to find the token
          app.models.languageToken
            .findOne({
              where: {
                token: languageToken.token,
                languageId: self.id
              }
            })
            .then(function (foundToken) {
              if (foundToken) {
                // if found, update translation
                return foundToken.updateAttributes({
                  translation: languageToken.translation
                }, options);
              } else {
                // if not found, create it
                return app.models.languageToken
                  .create({
                    token: languageToken.token,
                    languageId: self.id,
                    translation: languageToken.translation
                  }, options);
              }
            })
            .then(function (token) {
              callback(null, token);
            })
            .catch(callback);
        });
      });
      // start creating/updating tokens
      async.parallelLimit(createLanguageTokens, 10, function (error, results) {
        if (error) {
          return reject(error)
        }
        resolve(results);
      });
    });
  };
};
