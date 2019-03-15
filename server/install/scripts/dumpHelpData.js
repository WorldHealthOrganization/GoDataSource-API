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
  // retrieve category items
  helpCategory
    .find()
    .catch(callback)

    // retrieve help categories
    .then((helpCategories) => {
      // retrieve help categories
      const exportData = {
        translations: {},
        helpCategories: []
      };
      const categoryDataMap = {};
      const tokensToTranslate = [];

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
          helpCategory.name,
          helpCategory.description
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

      // get items
      return new Promise((resolve, reject) => {
        // retrieve category items
        helpItem
          .find({
            where: {
              categoryId: {
                inq: Object.keys(categoryDataMap)
              }
            }
          })
          .catch(reject)
          .then((helpItems) => {
            // go through help items and export needed data
            (helpItems || []).forEach((helpItem) => {
              // push item to parent category
              exportData.helpCategories[categoryDataMap[helpItem.categoryId]].items.push({
                id: helpItem.id,
                title: helpItem.title,
                content: helpItem.content,
                comment: helpItem.comment,
                page: helpItem.page
              });

              // translate tokens
              tokensToTranslate.push(
                helpItem.title,
                helpItem.content
              );
            });

            // finished
            resolve(data);
          });
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
                inq: tokensToTranslate
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
          console.log('Dumped Help Data');
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
