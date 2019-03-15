'use strict';

const app = require('../../server');
const languageToken = app.models.languageToken;
const helpCategory = app.models.helpCategory;
const helpItem = app.models.helpItem;
const defaultHelpData = require('./defaultHelpData.json');
const common = require('./_common');
const async = require('async');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
// let options = {
//   _init: true,
//   _sync: true
// };

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // make sure we have what we need :)
  const defaultHelpDataJson = defaultHelpData || [];

  // import help items
  languageToken
    .find({
      where: {
        id: {
          inq: Object.keys(defaultHelpDataJson.translations)
        }
      }
    })

    // handle errors
    .catch(callback)

    // determine which language tokens exist already and include them for update
    .then((langTokens) => {
      // map tokens for which we need to update data
      const createUpdateLanguageTokensJob = [];
      (langTokens || []).forEach((langToken) => {
        // add update job
        createUpdateLanguageTokensJob.push((cb) => {
          // update only if necessary
          if (
            !defaultHelpDataJson.translations[langToken.token] ||
            typeof defaultHelpDataJson.translations[langToken.token][langToken.languageId] !== 'string'
          ) {
            // finished
            app.logger.debug(`Translation missing for ${langToken.token} => ${langToken.languageId}`);
            cb();
          } else {
            // check if translation is the same
            if (defaultHelpDataJson.translations[langToken.token][langToken.languageId] === langToken.translation) {
              // finished
              app.logger.debug(`Translation is the same for ${langToken.token} => ${langToken.languageId}`);
              cb();
            } else {
              // display log
              app.logger.debug(`Updating ${langToken.token} => ${langToken.languageId} ...`);

              // update
              langToken
                .updateAttributes({
                  translation: defaultHelpDataJson.translations[langToken.token][langToken.languageId]
                })
                .catch(cb)
                .then(() => {
                  // finished
                  app.logger.debug(`Updated ${langToken.token} => ${langToken.languageId}`);
                  cb();
                });
            }
          }
        });

        // delete token that we need to update so we don't create a new one
        if (defaultHelpDataJson.translations[langToken.token]) {
          delete defaultHelpDataJson.translations[langToken.token][langToken.languageId];
        }
      });

      // create new language tokens
      Object.keys(defaultHelpDataJson.translations || {})
        .forEach((token) => {
          // go through each language token
          Object.keys(defaultHelpDataJson.translations[token] || {})
            .forEach((languageId) => {
              // display log
              app.logger.debug(`Creating ${token} => ${languageId} ...`);

              // add to create list
              createUpdateLanguageTokensJob.push((cb) => {
                languageToken
                  .create({
                    token: token,
                    languageId: languageId,
                    translation: defaultHelpDataJson.translations[token][languageId]
                  })
                  .catch(cb)
                  .then(() => {
                    // finished
                    app.logger.debug(`Created ${token} => ${languageId}`);
                    cb();
                  });
              });
            });
        });

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(createUpdateLanguageTokensJob, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // finished
          resolve();
        });
      });
    })
    .then(() => {
      console.log('Default Help Data Installed');
      callback();
    });


  // let setUpReferenceData = [];
  //
  // // go through all reference data categories
  // Object.keys(defaultReferenceData).forEach(function (referenceDataCategory) {
  //   // go through all reference data items
  //   Object.keys(defaultReferenceData[referenceDataCategory]).forEach(function (referenceDataItem) {
  //     // build item key
  //     let referenceDataItemKey = referenceData.getTranslatableIdentifierForValue(referenceDataCategory, referenceDataItem);
  //     // create reference data item (if not already there
  //     setUpReferenceData.push(
  //       function (cb) {
  //         referenceData
  //           .findById(referenceDataItemKey)
  //           .then(function (foundReferenceData) {
  //             if (!foundReferenceData) {
  //               return referenceData
  //                 .create(Object.assign({
  //                   id: referenceDataItemKey,
  //                   value: referenceDataItemKey,
  //                   description: `${referenceDataItemKey}_DESCRIPTION`,
  //                   categoryId: referenceDataCategory,
  //                   readOnly: defaultReferenceData[referenceDataCategory][referenceDataItem].readOnly,
  //                   colorCode: defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode,
  //                   iconId: defaultReferenceData[referenceDataCategory][referenceDataItem].iconId
  //                 }, common.install.timestamps), options);
  //             }
  //             return foundReferenceData;
  //           })
  //           .then(function () {
  //             cb();
  //           })
  //           .catch(cb);
  //       }
  //     );
  //   });
  // });
  //
  // // wait for all operations to be done
  // async.parallelLimit(setUpReferenceData, 10, function (error) {
  //   if (error) {
  //     return callback(error);
  //   }
  //   console.log('Default Reference Data Installed');
  //   callback();
  // });
}

module.exports = run;
