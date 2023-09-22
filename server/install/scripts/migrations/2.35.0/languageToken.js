'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const localizationHelper = require('../../../../../components/localizationHelper');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Add missing sort keys to language tokens
 * @param callback
 */
const addMissingTokenSortKeys = (callback) => {
  // create Mongo DB connection
  let languageTokenCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      languageTokenCollection = dbConn.collection('languageToken');

      // initialize filter
      // - update deleted items too
      // - update only items that don't have the token already set
      let languageTokenFilter = {
        tokenSortKey: {
          $exists: false
        }
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count language tokens that we need to update
        return languageTokenCollection
          .countDocuments(languageTokenFilter);
      };

      // get language tokens for batch
      const getBatchData = (batchNo, batchSize) => {
        return languageTokenCollection
          .find(languageTokenFilter, {
            // always getting the first items as the already modified ones are filtered out
            skip: 0,
            limit: batchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              _id: 1,
              token: 1,
              tokenSortKey: 1
            }
          })
          .toArray();
      };

      // update language token
      const itemAction = (data) => {
        const tokenSortKey = data.token ? data.token.substr(0, 128) : '';
        return languageTokenCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': {
              tokenSortKey: tokenSortKey
            }
          });
      };

      // execute jobs in batches
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        findBatchSize,
        updateBatchSize,
        console
      );
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Remove the language tokens of deleted outbreaks
 * @param [options] Optional
 * @param [options.outbreakName] Outbreak for which to delete language tokens
 * @param callback
 */
const removeTokensOfDeletedOutbreak = (options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  let outbreakCollection, languageTokenCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');
      languageTokenCollection = dbConn.collection('languageToken');

      // depending on given options we might just want to delete tokens of a given outbreak
      let getOutbreakIds;
      if (options.outbreakName && options.outbreakName.length) {
        getOutbreakIds = outbreakCollection
          .findOne({
            name: options.outbreakName,
            deleted: true
          }, {
            projection: {
              _id: 1
            }
          })
          .then(outbreak => {
            if (!outbreak) {
              return Promise.reject(`Given outbreak ${options.outbreakName} was not found in system or is not deleted`);
            }

            return [outbreak._id];
          });
      } else {
        getOutbreakIds = outbreakCollection
          .find({
            deleted: true
          }, {
            projection: {
              _id: 1
            }
          })
          .toArray()
          .then(outbreaks => {
            return outbreaks.map(outbreak => outbreak._id);
          });
      }

      return getOutbreakIds;
    })
    .then(outbreakIds => {
      if (!outbreakIds.length) {
        console.log('No deleted outbreaks were found in the system');
        return Promise.resolve(0);
      }

      // delete all outbreak related language tokens
      return languageTokenCollection
        .updateMany({
          deleted: false,
          token: {
            $regex: new RegExp(`${outbreakIds.join('|')}`, 'i')
          }
        }, {
          '$set': {
            deleted: true,
            deletedAt: localizationHelper.now().toDate()
          }
        })
        .then(result => {
          return Promise.resolve(result.modifiedCount);
        });
    })
    .then(tokensNo => {
      console.log(`Removed ${tokensNo} language tokens`);
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  addMissingTokenSortKeys,
  removeTokensOfDeletedOutbreak
};
