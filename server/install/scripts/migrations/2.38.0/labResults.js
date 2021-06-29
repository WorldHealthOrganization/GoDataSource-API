'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

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
            // always getting the first items as the already modified ones are filtered out
            skip: 0,
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
              personType: data.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ?
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' :
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
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
