'use strict';

const app = require('../../server');
const languageToken = app.models.languageToken;
const outbreakTemplate = app.models.template;
const fs = require('fs');

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // determine languages for which we need to export data
  fs.readdir(
    './server/config/languages',
    (err, files) => {
      // check if we encountered any errors
      if (err) {
        return callback(err);
      }

      // determine files ids
      const languageIds = [];
      (files || []).forEach((fileName) => {
        const languageData = require(`../../../server/config/languages/${fileName}`);
        languageIds.push(languageData.id);
      });

      // retrieve items
      outbreakTemplate
        .find({
          order: [
            'name asc'
          ]
        })
        .catch(callback)

        // retrieved items
        .then((outbreakTemplates) => {
          // retrieve language data
          const tokensToTranslate = [];
          const exportData = {
            translations: {},
            outbreakTemplates: []
          };

          // go through items and export needed data
          (outbreakTemplates || []).forEach((item) => {
            // push item
            exportData.outbreakTemplates.push({
              id: item.id,
              name: item.name,
              disease: item.disease,
              periodOfFollowup: item.periodOfFollowup,
              frequencyOfFollowUp: item.frequencyOfFollowUp,
              noDaysAmongContacts: item.noDaysAmongContacts,
              noDaysInChains: item.noDaysInChains,
              noDaysNotSeen: item.noDaysNotSeen,
              noLessContacts: item.noLessContacts,
              noDaysNewContacts: item.noDaysNewContacts,
              caseInvestigationTemplate: item.caseInvestigationTemplate,
              contactFollowUpTemplate: item.contactFollowUpTemplate,
              labResultsTemplate: item.labResultsTemplate
            });

            // translate tokens
            tokensToTranslate.push(
              item.disease
            );
          });

          // next
          return Promise.resolve({
            exportData: exportData,
            tokensToTranslate: tokensToTranslate
          });
        })

        // translate items
        .then((data) => {
          // retrieve tokens
          const exportData = data.exportData;
          const tokensToTranslate = data.tokensToTranslate;
          return new Promise((resolve, reject) => {
            // retrieve tokens translations
            languageToken
              .find({
                where: {
                  token: {
                    inq: tokensToTranslate
                  },
                  languageId: {
                    in: languageIds
                  }
                }
              })
              .catch(reject)
              .then((languageTokens) => {
                // add tokens to list
                (languageTokens || []).forEach((languageToken) => {
                  // init ?
                  if (!exportData.translations[languageToken.token]) {
                    exportData.translations[languageToken.token] = {};
                  }

                  // add translation
                  exportData.translations[languageToken.token][languageToken.languageId] = languageToken.translation;
                });

                // finished
                resolve(data);
              });
          });
        })

        // write file content
        .then((data) => {
          // data
          const exportData = data.exportData;

          // export data
          fs.writeFile(
            module.resolvedPath,
            JSON.stringify(exportData, null, 2),
            (err) => {
              // an error occurred ?
              if (err) {
                return callback(err);
              }

              // finished
              console.log('Dumped Outbreak Template Data');
              callback();
            }
          );
        });
    }
  );
}

module.exports = (resolvedPath) => {
  // keep path
  module.resolvedPath = resolvedPath;

  // finished
  return run;
};
