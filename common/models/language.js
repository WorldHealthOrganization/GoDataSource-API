'use strict';

const app = require('../../server/server');
const async = require('async');
const _ = require('lodash');
const addMissingLanguageTokens = require('../../server/install/scripts/addMissingLanguageTokens');

module.exports = function (Language) {

  /**
   * Update translations for a language
   * @param languageTokens [{token: 'string', translation: 'string'}]
   * @param options
   * @param tryToDetermineModulesAndOutbreak
   * @return {Promise<any>} list of created/updated records
   */
  Language.prototype.updateLanguageTranslations = function (
    languageTokens,
    options,
    tryToDetermineModulesAndOutbreak
  ) {
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
              // create update token
              const createUpdateToken = (outbreakId, modules) => {
                // create / update token
                if (foundToken) {
                  // token update data
                  const tokenUpdateData = {
                    translation: languageToken.translation,
                    outbreakId: outbreakId,
                    modules: modules
                  };

                  // add is default language token ?
                  if (languageToken.isDefaultLanguageToken !== undefined) {
                    tokenUpdateData.isDefaultLanguageToken = languageToken.isDefaultLanguageToken;
                  }

                  // add section
                  if (languageToken.section !== undefined) {
                    tokenUpdateData.section = languageToken.section;
                  }

                  // if found, update translation
                  return foundToken.updateAttributes(
                    tokenUpdateData,
                    options
                  );
                }

                // token create data
                const tokenCreateData = {
                  token: languageToken.token,
                  languageId: self.id,
                  translation: languageToken.translation,
                  outbreakId: outbreakId,
                  modules: modules,
                  createdAt: languageToken.createdAt,
                  updatedAt: languageToken.updatedAt,
                  dbUpdatedAt: new Date()
                };

                // add is default language token ?
                if (languageToken.isDefaultLanguageToken !== undefined) {
                  tokenCreateData.isDefaultLanguageToken = languageToken.isDefaultLanguageToken;
                }

                // add section
                if (languageToken.section !== undefined) {
                  tokenCreateData.section = languageToken.section;
                }

                // if not found, create it
                return app.models.languageToken
                  .create(
                    tokenCreateData,
                    options
                  );
              };

              // determine outbreak
              let outbreakId = languageToken.outbreakId;
              if (
                !outbreakId &&
                foundToken
              ) {
                outbreakId = foundToken.outbreakId;
              }

              // determine modules
              let modules = languageToken.modules;
              if (
                _.isEmpty(modules) &&
                foundToken
              ) {
                modules = foundToken.modules;
              }

              // for import / create new language.. we should overwrite these values with the ones we find in the system ( not always english..since other might become the default language )
              // find first token that has modules ...and optional outbreakId and overwrite these values
              if (
                !tryToDetermineModulesAndOutbreak ||
                !_.isEmpty(modules)
              ) {
                return createUpdateToken(
                  outbreakId,
                  modules
                );
              }

              // determine if there is a different language that has modules and maybe outbreakId for this token
              return app.models.languageToken
                .rawFind({
                  token: languageToken.token,
                  modules: {
                    exists: true
                  }
                }, {
                  projection: {
                    _id: 1,
                    outbreakId: 1,
                    modules: 1
                  }
                })
                .then(function (tokens) {
                  // go through tokens and try to determine modules and outbreak id
                  let outbreakId;
                  let modules;
                  if (!_.isEmpty(tokens)) {
                    let tokenData;
                    for (tokenData of tokens) {
                      // determine outbreak
                      outbreakId = outbreakId || tokenData.outbreakId;

                      // determine modules
                      if (!_.isEmpty(tokenData.modules)) {
                        modules = modules || tokenData.modules;
                      }

                      // if we have both..we can stop
                      if (
                        outbreakId &&
                        !_.isEmpty(tokenData.modules)
                      ) {
                        break;
                      }
                    }
                  }

                  // create / update token
                  return createUpdateToken(
                    outbreakId,
                    modules
                  );
                });
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

  /**
   * Clone english tokens if this is a new language
   */
  Language.observe('after save', (ctx, next) => {
    // clone tokens from another language - preferably english
    if (
      ctx.isNewInstance && (
        !ctx.options ||
        !ctx.options._init
      )
    ) {
      // clone tokens for this language and fix other languages in case they have missing language tokens
      addMissingLanguageTokens.checkAndAddMissingLanguageTokens(
        next,
        ctx.instance.id
      );
    } else {
      next();
    }
  });
};
