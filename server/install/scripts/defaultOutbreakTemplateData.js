'use strict';

const app = require('../../server');
const languageToken = app.models.languageToken;
const outbreakTemplate = app.models.template;
const defaultOutbreakTemplateData = require('./defaultOutbreakTemplateData.json');
const common = require('./_common');
const async = require('async');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
let options = {
  _init: true,
  _sync: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // make sure we have what we need :)
  const defaultOutbreakTemplateDataJson = defaultOutbreakTemplateData || [];

  // ignore existing help items
  languageToken
    .find({
      where: {
        token: {
          inq: Object.keys(defaultOutbreakTemplateDataJson.translations)
        }
      }
    })

    // handle errors
    .catch(callback)

    // determine which language tokens exist already and include them for update
    .then((langTokens) => {
      // map tokens for which we need to update data
      const createUpdateLanguageTokensJob = [];
      (langTokens || []).forEach((langTokenModel) => {
        // add update job
        const fileTranslation = defaultOutbreakTemplateDataJson.translations[langTokenModel.token] ?
          defaultOutbreakTemplateDataJson.translations[langTokenModel.token][langTokenModel.languageId] :
          undefined;

        // delete token that we need to update so we don't create a new one
        if (defaultOutbreakTemplateDataJson.translations[langTokenModel.token]) {
          delete defaultOutbreakTemplateDataJson.translations[langTokenModel.token][langTokenModel.languageId];
        }

        // update only if necessary
        if (typeof fileTranslation !== 'string') {
          // finished
          app.logger.debug(`Translation missing for ${langTokenModel.token} => ${langTokenModel.languageId}`);

        // check if translation is the same
        } else if (fileTranslation === langTokenModel.translation) {
          // finished
          app.logger.debug(`Translation is the same for ${langTokenModel.token} => ${langTokenModel.languageId}`);
        } else {
app.logger.debug(`U: ${langTokenModel.token}`);
          (function (langToken, newTranslation) {
            createUpdateLanguageTokensJob.push((cb) => {
              // display log
              app.logger.debug(`Updating token ${langToken.token} => ${langToken.languageId} ...`);

              // update
              langToken
                .updateAttributes({
                  translation: newTranslation
                }, options)
                .catch(cb)
                .then(() => {
                  // finished
                  app.logger.debug(`Updated token ${langToken.token} => ${langToken.languageId}`);
                  cb();
                });
            });
          })(langTokenModel, fileTranslation);
        }
      });

      // create new language tokens
      Object.keys(defaultOutbreakTemplateDataJson.translations || {})
        .forEach((token) => {
app.logger.debug(`U: ${token}`);
          // // go through each language token
          // Object.keys(defaultHelpDataJson.translations[token] || {})
          //   .forEach((languageId) => {
          //     (function (newToken, newLanguageId, newTranslation) {
          //       // add to create list
          //       createUpdateLanguageTokensJob.push((cb) => {
          //         // display log
          //         app.logger.debug(`Creating token ${newToken} => ${newLanguageId} ...`);
          //
          //         // create token
          //         languageToken
          //           .create(Object.assign({
          //             token: newToken,
          //             languageId: newLanguageId,
          //             translation: newTranslation
          //           }, common.install.timestamps), options)
          //           .catch(cb)
          //           .then(() => {
          //             // finished
          //             app.logger.debug(`Created token ${newToken} => ${newLanguageId}`);
          //             cb();
          //           });
          //       });
          //     })(token, languageId, defaultHelpDataJson.translations[token][languageId]);
          //   });
        });

      return [];
      // // execute jobs
      // return new Promise((resolve, reject) => {
      //   // wait for all operations to be done
      //   async.parallelLimit(createUpdateLanguageTokensJob, 10, function (error) {
      //     // error
      //     if (error) {
      //       return reject(error);
      //     }
      //
      //     // finished
      //     resolve();
      //   });
      // });
    })

    // // create help categories
    // .then(() => {
    //   // execute jobs
    //   return new Promise((resolve, reject) => {
    //     // map categories for easy find
    //     const categoriesMap = {};
    //     (defaultHelpDataJson.helpCategories || [])
    //       .forEach((category) => {
    //         categoriesMap[category.id] = category;
    //       });
    //
    //     // determine which help categories exist already
    //     const createUpdateCategoriesJobs = [];
    //     const categoryIds = Object.keys(categoriesMap);
    //     const existingCategories = {};
    //     helpCategory
    //       .find({
    //         where: {
    //           id: {
    //             inq: categoryIds
    //           }
    //         }
    //       })
    //       .catch(reject)
    //       .then((categoryModels) => {
    //         (categoryModels || []).forEach((categoryModel) => {
    //           // add to list of existing categories so we can exclude it from creation
    //           existingCategories[categoryModel.id] = true;
    //
    //           // determine if we need to update category
    //           const fileCategory = categoriesMap[categoryModel.id];
    //           if (
    //             categoryModel.name === fileCategory.name &&
    //             categoryModel.order === fileCategory.order &&
    //             categoryModel.description === fileCategory.description
    //           ) {
    //             // finished
    //             app.logger.debug(`No need to update category ${categoryModel.id}`);
    //           } else {
    //             // update category
    //             (function (updateCategoryModel, data) {
    //               // update category
    //               createUpdateCategoriesJobs.push((cb) => {
    //                 // display log
    //                 app.logger.debug(`Updating category ${updateCategoryModel.id} ...`);
    //
    //                 // update
    //                 updateCategoryModel
    //                   .updateAttributes({
    //                     name: data.name,
    //                     order: data.order,
    //                     description: data.description
    //                   }, options)
    //                   .catch(cb)
    //                   .then(() => {
    //                     // finished
    //                     app.logger.debug(`Updated category ${updateCategoryModel.id}`);
    //                     cb();
    //                   });
    //               });
    //             })(categoryModel, fileCategory);
    //           }
    //         });
    //
    //         // create categories that weren't updated
    //         (defaultHelpDataJson.helpCategories || []).forEach((category) => {
    //           // don't create category if we've updated this one
    //           if (existingCategories[category.id]) {
    //             return;
    //           }
    //
    //           // create category
    //           (function (newCategory) {
    //             // create category
    //             createUpdateCategoriesJobs.push((cb) => {
    //               // display log
    //               app.logger.debug(`Creating category ${newCategory.id} ...`);
    //
    //               // create
    //               helpCategory
    //                 .create(Object.assign({
    //                   id: newCategory.id,
    //                   name: newCategory.name,
    //                   order: newCategory.order,
    //                   description: newCategory.description
    //                 }, common.install.timestamps), options)
    //                 .catch(cb)
    //                 .then(() => {
    //                   // finished
    //                   app.logger.debug(`Created category ${newCategory.id}`);
    //                   cb();
    //                 });
    //             });
    //           })(category);
    //         });
    //
    //         // wait for all operations to be done
    //         async.parallelLimit(createUpdateCategoriesJobs, 10, function (error) {
    //           // error
    //           if (error) {
    //             return reject(error);
    //           }
    //
    //           // finished
    //           resolve();
    //         });
    //       });
    //   });
    // })
    //
    // // create help categories items
    // .then(() => {
    //   // execute jobs
    //   return new Promise((resolve, reject) => {
    //     // map category help items for easy find
    //     const itemMap = {};
    //     (defaultHelpDataJson.helpCategories || [])
    //       .forEach((category) => {
    //         (category.items || []).forEach((item) => {
    //           // keep category id
    //           item.categoryId = category.id;
    //
    //           // map
    //           itemMap[item.id] = item;
    //         });
    //       });
    //
    //     // determine which help category items exist already
    //     const createUpdateCategoryItemsJobs = [];
    //     const itemsIds = Object.keys(itemMap);
    //     const existingHelpItems = {};
    //     helpItem
    //       .find({
    //         where: {
    //           id: {
    //             inq: itemsIds
    //           }
    //         }
    //       })
    //       .catch(reject)
    //       .then((helpItemModels) => {
    //         (helpItemModels || []).forEach((helpItemModel) => {
    //           // add to list of existing help items so we can exclude it from creation
    //           existingHelpItems[helpItemModel.id] = true;
    //
    //           // determine if we need to update help item
    //           const fileHelpItem = itemMap[helpItemModel.id];
    //           if (
    //             helpItemModel.title === fileHelpItem.title &&
    //             helpItemModel.content === fileHelpItem.content &&
    //             helpItemModel.comment === fileHelpItem.comment &&
    //             helpItemModel.approved
    //           ) {
    //             // finished
    //             app.logger.debug(`No need to update help item ${helpItemModel.id}`);
    //           } else {
    //             // update help item
    //             (function (updateHelpItemModel, data) {
    //               createUpdateCategoryItemsJobs.push((cb) => {
    //                 // display log
    //                 app.logger.debug(`Updating help item ${updateHelpItemModel.id} ...`);
    //
    //                 // update
    //                 updateHelpItemModel
    //                   .updateAttributes({
    //                     title: data.title,
    //                     content: data.content,
    //                     comment: data.comment,
    //                     categoryId: data.categoryId,
    //                     order: data.order,
    //                     approved: true
    //                   }, options)
    //                   .catch(cb)
    //                   .then(() => {
    //                     // finished
    //                     app.logger.debug(`Updated help item ${updateHelpItemModel.id}`);
    //                     cb();
    //                   });
    //               });
    //             })(helpItemModel, fileHelpItem);
    //           }
    //         });
    //
    //         // create help items that weren't updated
    //         (Object.values(itemMap)).forEach((helpItemData) => {
    //           // don't create help item if we've updated this one
    //           if (existingHelpItems[helpItemData.id]) {
    //             return;
    //           }
    //
    //           // create help item
    //           (function (newHelpItem) {
    //             createUpdateCategoryItemsJobs.push((cb) => {
    //               // display log
    //               app.logger.debug(`Creating help item ${newHelpItem.id} ...`);
    //
    //               // create
    //               helpItem
    //                 .create(Object.assign({
    //                   id: newHelpItem.id,
    //                   title: newHelpItem.title,
    //                   content: newHelpItem.content,
    //                   comment: newHelpItem.comment,
    //                   categoryId: newHelpItem.categoryId,
    //                   order: newHelpItem.order,
    //                   approved: true
    //                 }, common.install.timestamps), options)
    //                 .catch(cb)
    //                 .then(() => {
    //                   // finished
    //                   app.logger.debug(`Created help item ${newHelpItem.id}`);
    //                   cb();
    //                 });
    //             });
    //           })(helpItemData);
    //         });
    //
    //         // wait for all operations to be done
    //         async.parallelLimit(createUpdateCategoryItemsJobs, 10, function (error) {
    //           // error
    //           if (error) {
    //             return reject(error);
    //           }
    //
    //           // finished
    //           resolve();
    //         });
    //       });
    //   });
    // })

    // finished
    .then(() => {
      console.log('Default Outbreak Template Data Installed');
      callback();
    });
}

module.exports = run;
