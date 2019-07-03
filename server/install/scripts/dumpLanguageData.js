'use strict';

const app = require('../../server');
const fs = require('fs');
const languageToken = app.models.languageToken;

const languageId = 'english_us';
const languageJSON = require(`./../../config/languages/${languageId}`);

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // retrieve tokens
  languageToken
    .find({
      where: {
        languageId: languageId
      }
    })

    // put db values into language
    .then((languageTokens) => {
      // map db tokens
      const tokensMap = {};
      (languageTokens || []).forEach((langTokenModel) => {
        tokensMap[langTokenModel.token] = langTokenModel;
      });

      // copy db values to file
      Object.keys(languageJSON.sections || []).forEach((section) => {
        Object.keys(languageJSON.sections[section]).forEach((token) => {
          // change translation ?
          if (tokensMap[token]) {
            languageJSON.sections[section][token] = tokensMap[token].translation;
          }
        });
      });
    })

    // write file content
    .then(() => {
      // export data
      fs.writeFile(
        module.resolvedPath,
        JSON.stringify(languageJSON, null, 2),
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
    })
    .catch(callback);
}

module.exports = (resolvedPath) => {
  // keep path
  module.resolvedPath = resolvedPath;

  // finished
  return run;
};
