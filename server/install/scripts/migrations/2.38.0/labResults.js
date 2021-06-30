'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 10000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Update personType field from the lab results records for the converted cases and contacts
 * @param callback
 */
const updatePersonType = (callback) => {
  // create Mongo DB connection
  let personCollection, labResultCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      personCollection = dbConn.collection('person');
      labResultCollection = dbConn.collection('labResult');

      // create filter
      // - update deleted items too
      // - update lab results records only for cases that were contacts and contacts were cases
      let personFilter = {
        $or: [
          {
            'type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
            'wasContact': true
          },
          {
            'type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
            'wasCase': true
          }]
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count records that we need to update
        return personCollection
          .countDocuments(personFilter);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        return personCollection
          .find(personFilter, {
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            projection: {
              _id: 1,
              type: 1
            }
          })
          .toArray();
      };

      // update lab results records
      const itemAction = (data) => {
        // update
        return labResultCollection
          .updateMany({
            personId: data._id
          }, {
            '$set': {
              personType: data.type
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
  updatePersonType
};
