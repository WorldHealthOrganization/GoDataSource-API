'use strict';

const app = require('../../server');
const languageToken = app.models.languageToken;
const helpCategory = app.models.helpCategory;
const helpItem = app.models.helpItem;
const fs = require('fs');

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // determine languages for which we need to export data
  const defaultLanguage = 'english_us';
  fs.readdir(
    './server/config/languages',
    (err, files) => {
      // check if we encountered any errors
      if (err) {
        return callback(err);
      }

      // determine files ids
      const languageIds = {};
      (files || []).forEach((fileName) => {
        const languageData = require(`../../../server/config/languages/${fileName}`);
        languageIds[languageData.id] = true;
      });

      // retrieve category items
      helpCategory
        .find({
          order: [
            'order asc'
          ]
        })

        // retrieve help categories
        .then((helpCategories) => {
          // retrieve help categories
          const exportData = {
            translations: {},
            helpCategories: []
          };
          const categoryDataMap = {};
          const tokensToTranslate = [];
          const helpCategoryModules = ['helpCategory'];

          // go through categories and export needed data
          (helpCategories || []).forEach((helpCategory) => {
            // push category
            exportData.helpCategories.push({
              id: helpCategory.id,
              name: helpCategory.name,
              order: helpCategory.order,
              description: helpCategory.description,
              items: []
            });

            // translate tokens
            tokensToTranslate.push(
              {
                token: helpCategory.name,
                modules: helpCategoryModules
              }, {
                token: helpCategory.description,
                modules: helpCategoryModules
              }
            );

            // map category
            categoryDataMap[helpCategory.id] = exportData.helpCategories.length - 1;
          });

          // next
          return Promise.resolve({
            exportData: exportData,
            categoryDataMap: categoryDataMap,
            tokensToTranslate: tokensToTranslate
          });
        })

        // retrieve help items
        .then((data) => {
          // data
          const exportData = data.exportData;
          const categoryDataMap = data.categoryDataMap;
          const tokensToTranslate = data.tokensToTranslate;
          const helpItemModules = ['helpItem'];

          // get items
          return new Promise((resolve, reject) => {
            // retrieve category items
            helpItem
              .find({
                where: {
                  categoryId: {
                    inq: Object.keys(categoryDataMap)
                  }
                },
                order: [
                  'order asc'
                ]
              })
              .then((helpItems) => {
                // go through help items and export needed data
                (helpItems || []).forEach((helpItem) => {
                  // push item to parent category
                  exportData.helpCategories[categoryDataMap[helpItem.categoryId]].items.push({
                    id: helpItem.id,
                    title: helpItem.title,
                    content: helpItem.content,
                    comment: helpItem.comment,
                    order: helpItem.order,
                    page: helpItem.page
                  });

                  // translate tokens
                  tokensToTranslate.push(
                    {
                      token: helpItem.title,
                      modules: helpItemModules
                    }, {
                      token: helpItem.content,
                      modules: helpItemModules
                    }
                  );
                });

                // finished
                resolve(data);
              })
              .catch(reject);
          });
        })

        // translate categories & items
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
                    in: Object.keys(languageIds)
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
          const tokenLanguages = Object.keys(languageIds);
          tokens.forEach((token) => {
            tokenLanguages.forEach((tokenLanguage) => {
              if (
                !exportData.translations[token][tokenLanguage] &&
                tokenLanguage !== defaultLanguage
              ) {
                exportData.translations[token][tokenLanguage] = exportData.translations[token][defaultLanguage];
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
              console.log('Dumped Help Data');
              callback();
            }
          );
        })

        .catch(callback);
    }
  );
}

module.exports = (resolvedPath) => {
  // keep path
  module.resolvedPath = resolvedPath;

  // finished
  return run;
};
