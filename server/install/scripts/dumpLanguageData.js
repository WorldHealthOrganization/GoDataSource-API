'use strict';

const app = require('../../server');
const fs = require('fs');
const languageToken = app.models.languageToken;
const englishUS = require('./../../config/languages/english_us');

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // retrieve tokens
  languageToken
    .find({
      where: {
        languageId: 'english_us'
      }
    })
    .catch(callback)

    // put db values into english_us
    .then((languageTokens) => {
      // map db tokens
      const tokensMap = {};
      (languageTokens || []).forEach((langTokenModel) => {
        tokensMap[langTokenModel.token] = langTokenModel;
      });

      // copy db values to file
      Object.keys(englishUS.sections || []).forEach((section) => {
        Object.keys(englishUS.sections[section]).forEach((token) => {
          // change translation ?
          if (tokensMap[token]) {
            englishUS.sections[section][token] = tokensMap[token].translation;
          }
        });
      });
    })

    // write file content
    .then(() => {
      // export data
      fs.writeFile(
        module.resolvedPath,
        JSON.stringify(englishUS, null, 2),
        (err) => {
          // an error occurred ?
          if (err) {
            return callback(err);
          }

          // finished
          console.log('Dumped Language Data');
          callback();
        }
      );
    });
}

module.exports = (resolvedPath) => {
  // keep path
  module.resolvedPath = resolvedPath;

  // finished
  return run;
};
