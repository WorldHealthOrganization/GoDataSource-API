'use strict';

const fs = require('fs');
const _ = require('lodash');
const app = require('../../server');
const referenceData = app.models.referenceData;
const defaultReferenceData = require('./defaultReferenceData.json');
const defaultOutbreakTemplateData = require('./defaultOutbreakTemplateData.json');
const languageToken = app.models.languageToken;

function run(callback) {
  // keep language data
  const defaultLanguageData = {};

  // map defaultReferenceData to so we can later map them properly
  const mapRefItemToDumpData = {};
  if (module.methodRelevantArgs.checkDefaultReferenceData) {
    _.each(defaultReferenceData, (referenceDataCategoryItems, referenceDataCategory) => {
      _.each(referenceDataCategoryItems, (refDataItem, refDataItemKey) => {
        // build item key
        let referenceDataItemKey = referenceData.getTranslatableIdentifierForValue(referenceDataCategory, refDataItemKey);
        mapRefItemToDumpData[referenceDataItemKey] = refDataItem;
      });
    });
  }

  // map defaultOutbreakTemplateData to so we can later map them properly
  const mapRefItemToOutbreakTemplate = {};
  if (module.methodRelevantArgs.checkDefaultOutbreakTemplateData) {
    (defaultOutbreakTemplateData.referenceData || []).forEach((item) => {
      mapRefItemToOutbreakTemplate[item.id] = item;
      mapRefItemToOutbreakTemplate[item.description] = item;
    });
  }

  // retrieve reference data items from database
  referenceData
    .find()
    .then((refDataItems) => {
      // retrieve current default language translations
      const mapTokenToSection = {};
      fs.readdirSync(`${__dirname}/../../config/languages`).forEach((language) => {
        // map tokens to translation
        const languageData = require(`${__dirname}/../../config/languages/${language}`);
        const languageID = languageData.id;
        defaultLanguageData[languageID] = languageData;
        mapTokenToSection[languageID] = {};
        _.each(defaultLanguageData[languageID].sections, (sectionData, sectionName) => {
          _.each(sectionData, (tokenData, token) => {
            mapTokenToSection[languageID][token] = sectionName;
          });
        });
      });

      // map ref items to categories
      const tokensToTranslate = {};
      const mapRefItemToCategory = {};
      refDataItems.forEach((item) => {
        // map
        mapRefItemToCategory[item.id] = item.categoryId;
        if (item.description) {
          mapRefItemToCategory[item.description] = item.categoryId;
        }

        // translate
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
              in: Object.keys(mapRefItemToCategory)
            },
            languageId: {
              in: Object.keys(defaultLanguageData)
            }
          }
        })
        .then((languageTokens) => {
          // go through each token and determine if we need to update anything
          const referenceDataModules = ['referenceData'];
          languageTokens.forEach((tokenData) => {
            // determine missing language tokens from database and fill them with empty values
            delete tokensToTranslate[tokenData.token];

            // determine section from token
            const languageSection = mapTokenToSection[tokenData.languageId][tokenData.token] ||
              mapTokenToSection[tokenData.languageId][mapRefItemToCategory[tokenData.token]];

            // update translation
            if (
              languageSection && (
                !defaultLanguageData[tokenData.languageId].sections[languageSection][tokenData.token] ||
                defaultLanguageData[tokenData.languageId].sections[languageSection][tokenData.token].translation !== tokenData.translation ||
                !_.isEqual(defaultLanguageData[tokenData.languageId].sections[languageSection][tokenData.token].modules, referenceDataModules)
              ) && (
                !module.methodRelevantArgs.checkDefaultOutbreakTemplateData ||
                !mapRefItemToOutbreakTemplate[tokenData.token]
              )
            ) {
              // translation
              _.set(
                defaultLanguageData,
                `[${tokenData.languageId}].sections[${languageSection}][${tokenData.token}].translation`,
                tokenData.translation
              );

              // outbreakId
              // NOT NEEDED

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
                // determine section from token
                const languageSection = mapTokenToSection[languageData.id][token] ||
                  mapTokenToSection[languageData.id][mapRefItemToCategory[token]];

                // set data
                if (
                  languageSection && (
                    !module.methodRelevantArgs.checkDefaultOutbreakTemplateData ||
                    !mapRefItemToOutbreakTemplate[token]
                  )
                ) {
                  // translation
                  _.set(
                    defaultLanguageData,
                    `[${languageData.id}].sections[${languageSection}][${token}].translation`,
                    ''
                  );

                  // outbreakId
                  // NOT NEEDED

                  // modules
                  _.set(
                    defaultLanguageData,
                    `[${languageData.id}].sections[${languageSection}][${token}].modules`,
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
      let noDifferencesDetected = true;
      (refDataItems || []).forEach((refDataItem) => {
        // check if ref data item is missing from our default reference data item list
        // or something is different :)
        let sameDataInDB = false;
        if (
          (
            module.methodRelevantArgs.checkDefaultReferenceData && (
              mapRefItemToDumpData[refDataItem.id] &&
              // handle differences
              refDataItem.colorCode === mapRefItemToDumpData[refDataItem.id].colorCode &&
              refDataItem.order === mapRefItemToDumpData[refDataItem.id].order
            )
          ) || (
            module.methodRelevantArgs.checkDefaultOutbreakTemplateData && (
              mapRefItemToOutbreakTemplate[refDataItem.id]
              // !IMPORTANT: in this case differences are handled by dumpOutbreakTemplateData
            )
          )
        ) {
          sameDataInDB = true;
        }

        // not found, or different ?
        if (!sameDataInDB) {
          // it seems we have differences
          noDifferencesDetected = false;

          // add / update defaultReferenceData
          let itemToUpdate;
          if (mapRefItemToDumpData[refDataItem.id]) {
            // update
            itemToUpdate = mapRefItemToDumpData[refDataItem.id];

            // log
            console.log(`Differences detected for reference item '${refDataItem.id}'`);
          } else {
            // approximate ref data item key
            const refDataItemKey = refDataItem.id.substr(refDataItem.categoryId.length + 1).trim();

            // create
            itemToUpdate = {
              readOnly: false
            };

            // add it to the list
            defaultReferenceData[refDataItem.categoryId][refDataItemKey] = itemToUpdate;

            // log
            console.log(`Missing reference item '${refDataItem.id}'`);
          }

          // update fields
          itemToUpdate.colorCode = refDataItem.colorCode;
          itemToUpdate.order = refDataItem.order;
        }
      });

      // no references detected ?
      if (noDifferencesDetected) {
        console.log('There are no differences in ref data items...');
      }

      // output
      if (module.methodRelevantArgs.export) {
        // write ref data items
        fs.writeFile(
          module.methodRelevantArgs.export,
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
            `${languageId}.json`,
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
      } else {
        // finished
        console.log('Finished determining reference data items');
        callback();
      }
    })
    .catch(callback);
}

module.exports = (methodRelevantArgs) => {
  // keep arguments
  module.methodRelevantArgs = methodRelevantArgs;

  // finished
  return run;
};
