'use strict';

const fs = require('fs');
const _ = require('lodash');
const app = require('../../../../server/server');
const referenceData = app.models.referenceData;
const language = app.models.language;
const languageToken = app.models.languageToken;

function run(callback) {
  // used to construct data that will be saved
  const defaultLanguageData = {};
  const defaultReferenceData = {};

  // default section
  const defaultSection = 'dump';

  // map defaultOutbreakTemplateData to so we can later map them properly
  const mapRefItemToOutbreakTemplate = {};
  (
    module.methodRelevantArgs.checkDefaultOutbreakTemplateData ?
      referenceData
        .find({
          where: {
            isOutbreakTemplateReferenceData: true
          },
          fields: {
            id: true,
            description: true
          }
        })
        .then((refData) => {
          // ref data items
          refData.forEach((refDataItem) => {
            mapRefItemToOutbreakTemplate[refDataItem.id] = true;
            if (refDataItem.description) {
              mapRefItemToOutbreakTemplate[refDataItem.description] = true;
            }
          });
        }) :
      Promise.resolve()
  )
    .then(() => {
      // retrieve reference data items from database
      return language
        .find({
          fields: {
            id: true,
            name: true,
            readOnly: true
          }
        });
    })
    .then((languages) => {
      // populate languages for which we will need to save the used language tokens
      languages.forEach((language) => {
        defaultLanguageData[language.id] = {
          id: language.id,
          name: language.name,
          readOnly: language.readOnly,
          sections: {}
        };
      });

      // retrieve reference data items from database
      return referenceData.find({
        fields: {
          id: true,
          categoryId: true,
          description: true,
          colorCode: true,
          order: true,
          readOnly: true
        }
      });
    })
    .then((refDataItems) => {
      // map ref items to categories
      const tokensToTranslate = {};
      refDataItems.forEach((item) => {
        tokensToTranslate[item.id] = true;
        if (item.description) {
          tokensToTranslate[item.description] = true;
        }
      });

      // retrieve language tokens
      return languageToken
        .find({
          where: {
            token: {
              in: Object.keys(tokensToTranslate)
            },
            languageId: {
              in: Object.keys(defaultLanguageData)
            }
          },
          fields: {
            id: true,
            token: true,
            languageId: true,
            translation: true,
            section: true
          }
        })
        .then((languageTokens) => {
          // go through each token and determine if we need to update anything
          const referenceDataModules = ['referenceData'];
          languageTokens.forEach((tokenData) => {
            // determine missing language tokens from database and fill them with empty values
            delete tokensToTranslate[tokenData.token];

            // determine section from token
            const languageSection = tokenData.section ?
              tokenData.section :
              defaultSection;

            // ignore outbreak template translations ?
            if (
              !module.methodRelevantArgs.checkDefaultOutbreakTemplateData ||
              !mapRefItemToOutbreakTemplate[tokenData.token]
            ) {
              // translation
              _.set(
                defaultLanguageData,
                `[${tokenData.languageId}].sections[${languageSection}][${tokenData.token}].translation`,
                tokenData.translation
              );

              // modules
              _.set(
                defaultLanguageData,
                `[${tokenData.languageId}].sections[${languageSection}][${tokenData.token}].modules`,
                referenceDataModules
              );
            }
          });

          // tokens missing from database that we need to translate to empty values
          if (!_.isEmpty(tokensToTranslate)) {
            _.each(tokensToTranslate, (data, token) => {
              // go through each language
              _.each(defaultLanguageData, (languageData) => {
                // set data
                if (
                  !module.methodRelevantArgs.checkDefaultOutbreakTemplateData ||
                  !mapRefItemToOutbreakTemplate[token]
                ) {
                  // translation
                  _.set(
                    defaultLanguageData,
                    `[${languageData.id}].sections[${defaultSection}][${token}].translation`,
                    ''
                  );

                  // modules
                  _.set(
                    defaultLanguageData,
                    `[${languageData.id}].sections[${defaultSection}][${token}].modules`,
                    referenceDataModules
                  );
                }
              });
            });
          }

          // finished - determining translations
          return {
            refDataItems: refDataItems
          };
        });
    })
    .then((data) => {
      // checking items
      const refDataItems = data.refDataItems;
      (refDataItems || []).forEach((refDataItem) => {
        // ignore ref data that exists in default templates ?
        // !IMPORTANT: in this case differences are handled by dumpOutbreakTemplateData
        if (
          module.methodRelevantArgs.checkDefaultOutbreakTemplateData &&
          mapRefItemToOutbreakTemplate[refDataItem.id]
        ) {
          return;
        }

        // approximate ref data item key
        const refDataItemKey = refDataItem.id.substr(refDataItem.categoryId.length + 1).trim();

        // add / update defaultReferenceData
        const itemToUpdate = {
          readOnly: !!refDataItem.readOnly
        };

        // add color only if exists
        if (refDataItem.colorCode) {
          itemToUpdate.colorCode = refDataItem.colorCode;
        }

        // add order only if exists
        if (refDataItem.order) {
          itemToUpdate.order = refDataItem.order;
        }

        // add it to the list
        _.set(
          defaultReferenceData,
          `[${refDataItem.categoryId}][${refDataItemKey}]`,
          itemToUpdate
        );
      });

      // write ref data items
      fs.writeFile(
        `${module.methodRelevantArgs.exportDir}/defaultReferenceData.json`,
        JSON.stringify(defaultReferenceData, null, 2),
        (err) => {
          // an error occurred ?
          if (err) {
            return callback(err);
          }

          // finished
          console.log('Dumped reference data to file');
          callback();
        }
      );

      // write default languages data
      _.each(defaultLanguageData, (languageData, languageId) => {
        fs.writeFile(
          `${module.methodRelevantArgs.exportDir}/${languageId}.json`,
          JSON.stringify(languageData, null, 2),
          (err) => {
            // an error occurred ?
            if (err) {
              return callback(err);
            }

            // finished
            console.log(`Dumped ${languageId} language data`);
            callback();
          }
        );
      });
    })
    .catch(callback);
}

module.exports = (methodRelevantArgs) => {
  // keep arguments
  module.methodRelevantArgs = methodRelevantArgs;

  // finished
  return run;
};
