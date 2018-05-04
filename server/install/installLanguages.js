'use strict';

const app = require('../server');
const fs = require('fs');
const async = require('async');

// keep a list of languages that need to be installed
const languageList = [];
// scan languages directory and read languages
fs.readdirSync(`${__dirname}/../config/languages`).forEach(function (language) {
  languageList.push(require(`${__dirname}/../config/languages/${language}`));
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
              name: language.name
            });
        }
        return foundLanguage;
      })
      .then(function (createdLanguage) {
        // keep a list of languages tokens to be created (for async lib)
        const createLanguageTokens = [];
        Object.keys(language.tokens).forEach(function (token) {
          // create/update token for language
          createLanguageTokens.push(function (callback) {
            // try to find the token
            app.models.languageToken
              .findOne({
                where: {
                  token: token,
                  languageId: createdLanguage.id
                }
              })
              .then(function (foundToken) {
                if (foundToken) {
                  // if found, update translation
                  return foundToken.updateAttributes({
                    translation: language.tokens[token]
                  });
                } else {
                  // if not found, create it
                  return app.models.languageToken
                    .create({
                      token: token,
                      languageId: createdLanguage.id,
                      translation: language.tokens[token]
                    });
                }
              })
              .then(function () {
                callback();
              })
              .catch(callback);
          });
        });
        // move to the next language after all tokens for current language have been created
        async.parallelLimit(createLanguageTokens, 10, callback);
      })
      .catch(callback);
  });

  // start creating languages (and tokens)
  async.series(createLanguages, function (error) {
    if (error) {
      process.stderr.write(JSON.stringify(error));
      process.exit(1);
    }
    process.stdout.write('Languages installed');
    process.exit();
  });
});
