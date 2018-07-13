'use strict';

const app = require('../../server');
const fs = require('fs');
const async = require('async');

// keep a list of languages that need to be installed
const languageList = [];
// scan languages directory and read languages
fs.readdirSync(`${__dirname}/../../config/languages`).forEach(function (language) {
  languageList.push(require(`${__dirname}/../../config/languages/${language}`));
});

// keep a list of languages to be created (for async lib)
const createLanguages = [];
languageList.forEach(function (language) {
  // find/create language
  createLanguages.push(function (callback) {
    // try to find the language
    app.models.language
      .findOne({
        where: {
          name: language.name
        }
      })
      .then(function (foundLanguage) {
        if (!foundLanguage) {
          // if not found, create it
          return app.models.language
            .create({
              id: language.id,
              name: language.name,
              readOnly: language.readOnly
            });
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
              translation: language.sections[section][token]
            });
          });
        });
        // move to the next language after all tokens for current language have been created
        return createdLanguage.updateLanguageTranslations(languageTokens)
          .then(function (languageTokens) {
            callback(null, languageTokens);
          });
      })
      .catch(callback);
  });
});

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // start creating languages (and tokens)
  async.series(createLanguages, function (error) {
    if (error) {
      return callback(error);
    }
    console.log('Languages installed');
    callback();
  });
}

module.exports = run;
