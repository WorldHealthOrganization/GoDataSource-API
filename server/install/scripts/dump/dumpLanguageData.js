'use strict';

const _ = require('lodash');
const app = require('../../../../server/server');
const fs = require('fs');
const language = app.models.language;
const languageToken = app.models.languageToken;

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // used to save language data
  let languageJSON;

  // retrieve language
  language
    .findOne({
      where: {
        id: module.languageId
      }
    })
    .then((language) => {
      // language not found ?
      if (!language) {
        throw new Error(`Language with id '${module.languageId}' not found`);
      }

      // used to save language data
      languageJSON = {
        id: language.id,
        name: language.name,
        readOnly: true,
        tokens: {}
      };

      // retrieve tokens
      return languageToken
        .find({
          where: {
            languageId: language.id,

            // do we want only default language tokens to be exported ?
            // isDefaultLanguageToken: true
          },
          fields: {
            id: true,
            section: true,
            token: true,
            translation: true,
            modules: true
          }
        });
    })

    // put db values into language
    .then((languageTokens) => {
      // map db tokens
      (languageTokens || []).forEach((langTokenModel) => {
        // translation
        _.set(
          languageJSON,
          `tokens[${langTokenModel.token}].translation`,
          langTokenModel.translation
        );

        // modules
        _.set(
          languageJSON,
          `tokens[${langTokenModel.token}].modules`,
          langTokenModel.modules
        );

        // section
        _.set(
          languageJSON,
          `tokens[${langTokenModel.token}].section`,
          langTokenModel.section
        );
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

module.exports = (
  languageId,
  resolvedPath
) => {
  // keep path
  module.languageId = languageId;
  module.resolvedPath = resolvedPath;

  // finished
  return run;
};
