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
    // keep a list of errors;
    const errors = [];
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
                    translation: languageToken.translation,
                    createdAt: languageToken.createdAt,
                    updatedAt: languageToken.updatedAt
                  }, options);
              }
            })
            .then(function (token) {
              callback(null, token);
            })
            .catch(function (error) {
              // store error
              errors.push({
                token: languageToken,
                error: error
              });
              // but continue updating languages
              callback();
            });
        });
      });
      // start creating/updating tokens
      async.parallelLimit(createLanguageTokens, 10, function (error, results) {
        // check if there was an error and handle it
        if (error) {
          return reject({
            errors: [error],
            success: results || []
          });
        }
        // check if errors were collected and handle them
        if (errors.length) {
          return reject({
            errors: errors,
            success: results || []
          });
        }
        resolve(results);
      });
    });
  };

  /**
   * Is language editable
   * @param callback
   */
  Language.prototype.isEditable = function (callback) {
    callback(null, !this.readOnly);
  };

  /**
   * Check if a language is editable
   * @param languageId
   * @param callback
   */
  Language.isEditable = function (languageId, callback) {
    Language
      .findById(languageId)
      .then(function (language) {
        language.isEditable(callback);
      })
      .catch(callback);
  };

  /**
   * Check if a language is editable
   * @param language language instance | language id
   * @param next
   */
  Language.checkIfEditable = function (language, next) {
    // assume language id is sent
    let languageId = language;
    // define check language function
    let checkIfLanguageIsEditable = Language.isEditable.bind(null, languageId);
    // if language is an instance
    if (typeof language === 'object') {
      // get language id
      languageId = language.id;
      // update check function
      checkIfLanguageIsEditable = language.isEditable.bind(language);
    }
    // check if the language is editable
    checkIfLanguageIsEditable(function (error, editable) {
      if (error) {
        return next(error);
      }
      // if the language is not editable, stop with error
      if (!editable) {
        return next(app.utils.apiError.getError('MODEL_NOT_EDITABLE', {
          model: Language.modelName,
          id: languageId
        }));
      }
      next();
    });
  };

  /**
   * Get language dictionary for the specified language (also include english as a fallback language)
   * @param languageId
   * @param callback
   */
  Language.getLanguageDictionary = function (languageId, callback) {
    app.models.languageToken.rawFind(
      {
        or: [
          {languageId: languageId},
          {languageId: 'english_us'}
        ]
      },
      {projection: {token: 1, translation: 1, languageId: 1}})
      .then(function (languageTokens) {
        // build a language map for easy referencing language tokens
        const tokensMap = {};
        languageTokens.forEach(function (languageToken) {
          tokensMap[`${languageToken.token}-${languageToken.languageId}`] = languageToken.translation;
        });
        /**
         * Get translation for a language token
         * @param field
         * @return {*}
         */
        tokensMap.getTranslation = function (field) {
          // first look for the translation in the specified language
          if (this[`${field}-${languageId}`]) {
            field = this[`${field}-${languageId}`];
            // then look for the translation in the english language
          } else if (this[`${field}-english_us`]) {
            field = this[`${field}-english_us`];
          }
          return field;
        };
        callback(null, tokensMap);
      })
      .catch(callback);
  };

  /**
   * @deprecated Use dictionary.getTranslation instead
   */
  Language.getFieldTranslationFromDictionary = function (field, languageId, dictionary) {
    return dictionary.getTranslation(field);
  };
};
