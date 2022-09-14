'use strict';

// imports
const fs = require('fs');
const async = require('async');
const app = require('../../../../server');
const common = require('./../../_common');

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // keep a list of languages that need to be installed
  const languageList = [];

  // scan languages directory and read languages
  const languagesPath = `${__dirname}/data/languages`;
  fs.readdirSync(languagesPath).forEach(function (language) {
    languageList.push(require(`${languagesPath}/${language}`));
  });

  // initialize action options; set _init flag to prevent execution of some after save scripts
  const options = {
    _init: true
  };

  // keep a list of languages to be created (for async lib)
  const createLanguages = [];
  languageList.forEach(function (language) {
    // find/create language
    createLanguages.push(function (callback) {
      // try to find the language
      app.models.language
        .findOne({
          where: {
            id: language.id
          }
        })
        .then(function (foundLanguage) {
          if (!foundLanguage) {
            // if not found, create it
            return app.models.language
              .create(Object.assign({
                id: language.id,
                name: language.name,
                readOnly: language.readOnly
              }, common.install.timestamps), options);
          }
          return foundLanguage;
        })
        .then(function (createdLanguage) {
          const languageTokens = [];
          // go through all language sections
          Object.keys(language.sections).forEach(function (section) {
            // go through all language tokens of each section
            Object.keys(language.sections[section]).forEach(function (token) {
              languageTokens.push({
                token: token,
                translation: language.sections[section][token].translation,
                outbreakId: language.sections[section][token].outbreakId,
                modules: language.sections[section][token].modules,
                createdAt: common.install.timestamps.createdAt,
                updatedAt: common.install.timestamps.updatedAt,
                isDefaultLanguageToken: true,
                section
              });
            });
          });
          // move to the next language after all tokens for current language have been created
          return createdLanguage.updateLanguageTranslations(languageTokens, options, false)
            .then(function (languageTokens) {
              callback(null, languageTokens);
            });
        })
        .catch(callback);
    });
  });

  // start creating languages (and tokens)
  async.series(createLanguages, function (error) {
    if (error) {
      return callback(error);
    }
    console.log('Languages installed');
    callback();
  });
}

module.exports = {
  run
};
