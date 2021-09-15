'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const Helpers = require('../../../components/helpers');
const uuid = require('uuid').v4;

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 7000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Create / Update language tokens
 */
const checkAndAddMissingLanguageTokens = (callback) => {
  // create Mongo DB connection
  const defaultLanguageId = 'english_us';
  let language, languageToken;
  let languageModels;
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      language = dbConn.collection('language');
      languageToken = dbConn.collection('languageToken');
    })
    .then(() => {
      return language
        .find({
          deleted: false
        }, {
          projection: {
            _id: 1,
            name: 1
          },
          sort: {
            name: 1
          }
        })
        .toArray();
    })
    .then((languages) => {
      // languages
      languageModels = languages;
    })
    .then(() => {
      // find default language and move it to top since this will be used first to translate missing tokens
      const defaultLanguageIndex = languageModels.findIndex((item) => item._id === defaultLanguageId);
      if (defaultLanguageIndex > 0) {
        const defaultLanguageItem = languageModels.splice(defaultLanguageIndex, 1)[0];
        languageModels.splice(0, 0, defaultLanguageItem);
      }

      // tokens that were already checked
      const alreadyCheckedTokens = {};

      // next language that we need to check
      const nextLanguage = (languageIndex) => {
        // finished ?
        if (languageIndex >= languageModels.length) {
          return Promise.resolve();
        }

        // define filter
        const languageTokenFilter = {
          languageId: languageModels[languageIndex]._id
        };

        // log
        console.debug(`Retrieving language tokens for ${languageModels[languageIndex].name}`);

        // initialize parameters for handleActionsInBatches call
        const getActionsCount = () => {
          // count records that we need to update
          return languageToken
            .countDocuments(languageTokenFilter);
        };

        // get records in batches
        const getBatchData = (batchNo, batchSize) => {
          return languageToken
            .find(languageTokenFilter, {
              skip: (batchNo - 1) * batchSize,
              limit: batchSize,
              projection: {
                token: 1
              },
              sort: {
                createdAt: 1
              }
            })
            .toArray();
        };

        // handle tokens
        const batchItemsAction = function (tokensForCurrentLanguage) {
          // exclude those that were already checked
          // & map remaining tokens
          const tokensToCheck = [];
          tokensForCurrentLanguage.forEach((tokenData) => {
            // already checked this one ?
            if (alreadyCheckedTokens[tokenData.token]) {
              return;
            }

            // add to tokens to check
            tokensToCheck.push(tokenData.token);

            // mark as checked
            alreadyCheckedTokens[tokenData.token] = true;
          });

          // if there are no tokens remaining then there is no point in continuing
          if (tokensToCheck.length < 1) {
            // log
            console.debug('All tokens from this batch were checked previously');

            // finished
            return Promise.resolve();
          }

          // start checking all other languages
          const getExistingTokensForLanguage = (compareLanguageIndex) => {
            // finished ?
            if (compareLanguageIndex >= languageModels.length) {
              return Promise.resolve();
            }

            // same language as the one that is currently checked ?
            if (languageIndex === compareLanguageIndex) {
              // next compare language
              compareLanguageIndex++;

              // next language to check
              return getExistingTokensForLanguage(compareLanguageIndex);
            }

            // log
            console.debug(`Comparing with tokens from language ${languageModels[compareLanguageIndex].name}`);

            // retrieve exiting languages from current batch
            return languageToken
              .find({
                languageId: languageModels[compareLanguageIndex]._id,
                token: {
                  $in: tokensToCheck
                }
              }, {
                projection: {
                  token: 1
                }
              })
              .toArray()
              .then((compareFoundTokens) => {
                // map found tokens for easy check
                const compareFoundTokensMap = {};
                compareFoundTokens.forEach((compareFoundToken) => {
                  compareFoundTokensMap[compareFoundToken.token] = true;
                });

                // determine missing tokens
                const missingTokens = [];
                tokensToCheck.forEach((token) => {
                  if (!compareFoundTokensMap[token]) {
                    missingTokens.push(token);
                  }
                });

                // no missing tokens ?
                if (missingTokens.length < 1) {
                  return Promise.resolve();
                }

                // retrieve missing tokens data
                return languageToken
                  .find({
                    languageId: languageModels[languageIndex]._id,
                    token: {
                      $in: missingTokens
                    }
                  })
                  .toArray()
                  .then((tokensToCreateData) => {
                    // next token to create
                    const createNextToken = () => {
                      // finished ?
                      if (tokensToCreateData.length < 1) {
                        return Promise.resolve();
                      }

                      // get token data that we need to create
                      const duplicateRecord = tokensToCreateData.splice(0, 1)[0];

                      // replace _id & language
                      duplicateRecord._id = uuid();
                      duplicateRecord.languageId = languageModels[compareLanguageIndex]._id;

                      // log
                      console.debug(`Creating missing token for '${duplicateRecord.languageId}', token '${duplicateRecord.token}'`);

                      // create token
                      return languageToken
                        .insert(duplicateRecord)
                        .then(createNextToken);
                    };

                    // start creating tokens synchronously
                    return createNextToken();
                  });
              })
              .then(() => {
                // next compare language
                compareLanguageIndex++;

                // next language to check
                return getExistingTokensForLanguage(compareLanguageIndex);
              });
          };

          // next language to check
          return getExistingTokensForLanguage(0);
        };

        // start checking tokens from this language
        return Helpers.handleActionsInBatches(
          getActionsCount,
          getBatchData,
          batchItemsAction,
          null,
          findBatchSize,
          updateBatchSize,
          console
        ).then(() => {
          // prepare for next language
          languageIndex++;

          // trigger check for next language
          return nextLanguage(languageIndex);
        });
      };

      // start with first language to check
      return nextLanguage(0);
    })
    .then(() => {
      // finished
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  checkAndAddMissingLanguageTokens
};
