'use strict';

const app = require('../../server');
const languageToken = app.models.languageToken;
const outbreakTemplate = app.models.template;
const referenceData = app.models.referenceData;
const fs = require('fs');
const _ = require('lodash');

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
          const referenceDataToGet = {};
          const exportData = {
            translations: {},
            referenceData: [], // question categories & diseases
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
            // NOTHING TO PUSH HERE
            // - name isn't translated
            // - disease will be handled separately
            // tokensToTranslate.push();

            // make sure we retrieve category information
            if (item.disease) {
              referenceDataToGet[item.disease] = true;
            }

            // push questionnaire translations
            const pushQuestionsTranslations = (questions) => {
              (questions || []).forEach((question) => {
                // question tokens
                // no need to push the following since they should already be in the system
                // - answerType
                // - answersDisplay
                // - category will be handled separately
                tokensToTranslate.push(
                  question.text
                );

                // make sure we retrieve category information
                if (question.category) {
                  referenceDataToGet[question.category] = true;
                }

                // answer tokens
                (question.answers || []).forEach((answer) => {
                  // answer tokens
                  tokensToTranslate.push(
                    answer.label
                  );

                  // answer questions
                  if (answer.additionalQuestions) {
                    pushQuestionsTranslations(answer.additionalQuestions);
                  }
                });
              });
            };

            // questionnaire translations
            pushQuestionsTranslations(item.caseInvestigationTemplate);
            pushQuestionsTranslations(item.contactFollowUpTemplate);
            pushQuestionsTranslations(item.labResultsTemplate);
          });

          // next
          return Promise.resolve({
            exportData: exportData,
            tokensToTranslate: tokensToTranslate,
            referenceDataToGet: referenceDataToGet
          });
        })

        // retrieve reference data ( diseases & question categories )
        .then((data) => {
          const exportData = data.exportData;
          const referenceDataToGet = data.referenceDataToGet;
          const tokensToTranslate = data.tokensToTranslate;
          return new Promise((resolve, reject) => {
            // nothing to retrieve ?
            if (_.isEmpty(referenceDataToGet)) {
              resolve(data);
              return;
            }

            // retrieve reference data
            referenceData
              .find({
                where: {
                  id: {
                    inq: Object.keys(referenceDataToGet)
                  }
                }
              })
              .catch(reject)
              .then((referenceDataItems) => {
                (referenceDataItems || []).forEach((referenceDataItem) => {
                  // add item
                  // - icon requires more complex logic for export / import so we will ignore ir for now...
                  // - active will always be true if found in default items...otherwise there is no point...to have it in the default items
                  exportData.referenceData.push({
                    id: referenceDataItem.id,
                    categoryId: referenceDataItem.categoryId,
                    value: referenceDataItem.value,
                    description: referenceDataItem.description,
                    colorCode: referenceDataItem.colorCode,
                    order: referenceDataItem.order
                  });

                  // translate
                  // - category is already in the system, since these aren't editable and they can be created only by the system
                  tokensToTranslate.push(
                    referenceDataItem.value,
                    referenceDataItem.description
                  );
                });

                // finished
                resolve(data);
              });
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
