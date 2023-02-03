'use strict';

const fs = require('fs');
const _ = require('lodash');
const app = require('../../../../server/server');
const referenceData = app.models.referenceData;
const language = app.models.language;
const languageToken = app.models.languageToken;
const outbreakTemplate = app.models.template;

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // map defaultReferenceData to so we can later map them properly
  const mappedRefData = {};
  let languageIds;
  referenceData
    .find({
      where: {
        isDefaultReferenceData: true
      },
      fields: {
        id: true
      }
    })
    .then((refData) => {
      // ref data items
      refData.forEach((refDataItem) => {
        mappedRefData[refDataItem.id] = true;
      });
    })
    .then(() => {
      // retrieve languages
      return language
        .find({
          fields: {
            id: true
          }
        });
    })
    .then((languages) => {
      // determine languages ids
      languageIds = languages.map((item) => item.id);

      // retrieve items
      return outbreakTemplate
        .find({
          order: [
            'name asc'
          ]
        });
    })
    .then((outbreakTemplates) => {
      // retrieve language data
      const templateModules = ['template'];
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
          description: item.description,
          disease: item.disease,
          periodOfFollowup: item.periodOfFollowup,
          frequencyOfFollowUp: item.frequencyOfFollowUp,
          frequencyOfFollowUpPerDay: item.frequencyOfFollowUpPerDay,
          generateFollowUpsOverwriteExisting: item.generateFollowUpsOverwriteExisting,
          generateFollowUpsKeepTeamAssignment: item.generateFollowUpsKeepTeamAssignment,
          generateFollowUpsTeamAssignmentAlgorithm: item.generateFollowUpsTeamAssignmentAlgorithm,
          generateFollowUpsDateOfLastContact: item.generateFollowUpsDateOfLastContact,
          intervalOfFollowUp: item.intervalOfFollowUp ? item.intervalOfFollowUp : '',
          noDaysAmongContacts: item.noDaysAmongContacts,
          noDaysInChains: item.noDaysInChains,
          noDaysNotSeen: item.noDaysNotSeen,
          noLessContacts: item.noLessContacts,
          longPeriodsBetweenCaseOnset: item.longPeriodsBetweenCaseOnset,
          noDaysNewContacts: item.noDaysNewContacts,
          caseInvestigationTemplate: item.caseInvestigationTemplate,
          contactInvestigationTemplate: item.contactInvestigationTemplate,
          contactFollowUpTemplate: item.contactFollowUpTemplate,
          labResultsTemplate: item.labResultsTemplate,
          isContactLabResultsActive: item.isContactLabResultsActive,
          isContactsOfContactsActive: item.isContactsOfContactsActive,
          isDateOfOnsetRequired: item.isDateOfOnsetRequired,
          applyGeographicRestrictions: item.applyGeographicRestrictions,
          checkLastContactDateAgainstDateOnSet: item.checkLastContactDateAgainstDateOnSet,
          disableModifyingLegacyQuestionnaire: item.disableModifyingLegacyQuestionnaire
        });

        // translate tokens
        // NOTHING TO PUSH HERE
        // - name isn't translated
        // - disease will be handled separately
        // tokensToTranslate.push();

        // make sure we retrieve category information
        if (
          item.disease &&
          !mappedRefData[item.disease]
        ) {
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
            tokensToTranslate.push({
              token: question.text,
              modules: templateModules
            });

            // make sure we retrieve category information
            if (
              question.category &&
              !mappedRefData[question.category]
            ) {
              referenceDataToGet[question.category] = true;
            }

            // answer tokens
            (question.answers || []).forEach((answer) => {
              // answer tokens
              tokensToTranslate.push({
                token: answer.label,
                modules: templateModules
              });

              // answer questions
              if (answer.additionalQuestions) {
                pushQuestionsTranslations(answer.additionalQuestions);
              }
            });
          });
        };

        // questionnaire translations
        pushQuestionsTranslations(item.caseInvestigationTemplate);
        pushQuestionsTranslations(item.contactInvestigationTemplate);
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
      const referenceDataModules = ['referenceData'];
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
                {
                  token: referenceDataItem.value,
                  modules: referenceDataModules
                }, {
                  token: referenceDataItem.description,
                  modules: referenceDataModules
                }
              );
            });

            // finished
            resolve(data);
          })
          .catch(reject);
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
                inq: tokensToTranslate.map((tokenData) => tokenData.token)
              },
              languageId: {
                in: languageIds
              }
            }
          })
          .then((languageTokens) => {
            // map tokens to token Data
            const tokensToTranslateMap = {};
            tokensToTranslate.forEach((tokenData) => {
              tokensToTranslateMap[tokenData.token] = tokenData;
            });

            // add tokens to list
            (languageTokens || []).forEach((languageToken) => {
              // init ?
              if (!exportData.translations[languageToken.token]) {
                exportData.translations[languageToken.token] = {};
              }

              // add translation
              exportData.translations[languageToken.token][languageToken.languageId] = languageToken.translation;

              // add outbreakId
              // NOT NEEDED

              // add modules
              exportData.translations[languageToken.token].modules = tokensToTranslateMap[languageToken.token].modules;
            });

            // finished
            resolve(data);
          })
          .catch(reject);
      });
    })

    // write file content
    .then((data) => {
      // data
      const exportData = data.exportData;

      // fill out with default values missing translations
      const tokens = Object.keys(exportData.translations);
      tokens.forEach((token) => {
        languageIds.forEach((tokenLanguage) => {
          if (
            !exportData.translations[token][tokenLanguage] &&
            tokenLanguage !== module.fallbackLanguageId
          ) {
            exportData.translations[token][tokenLanguage] = exportData.translations[token][module.fallbackLanguageId];
          }
        });
      });

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
    })

    .catch(callback);
}

module.exports = (
  fallbackLanguageId,
  resolvedPath
) => {
  // keep path
  module.fallbackLanguageId = fallbackLanguageId;
  module.resolvedPath = resolvedPath;

  // finished
  return run;
};
