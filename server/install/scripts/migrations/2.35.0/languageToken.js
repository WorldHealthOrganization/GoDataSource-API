'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

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

// export list of migration jobs; functions that receive a callback
module.exports = {
  addMissingTokenSortKeys
};
