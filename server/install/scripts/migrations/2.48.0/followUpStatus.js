'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Replace a followUp status for persons
 * @param callback
 */
const replaceFollowUpStatus = (callback) => {
  // person collection
  let personCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collections
      personCollection = dbConn.collection('person');

      // initialize parameters for handleActionsInBatches call
      const personQuery = {
        'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_NEVER_ILL_NOT_A_CASE'
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count persons
        return personCollection
          .countDocuments(personQuery);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        // get records for batch
        return personCollection
          .find(personQuery, {
            // always getting the first items as the already modified ones are filtered out
            skip: 0,
            limit: batchSize,
            projection: {
              _id: 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // log
        console.log('The "Never ill/not a case" status will be replaced for the following person: ' + data._id);

        // replace followup status to resulted persons
        return personCollection
          .updateOne({
            _id: data._id
          }, {
            $set: {
              'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_FOLLOW_UP_COMPLETED'
            }
          });
      };

      // execute
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
 * Delete a followUp status
 * @param callback
 */
const deleteFollowUpStatus = (callback) => {
  // reference data collection
  let referenceDataCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      referenceDataCollection = dbConn.collection('referenceData');

      // get item
      return referenceDataCollection
        .findOne({
          _id: 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_NEVER_ILL_NOT_A_CASE',
          categoryId: 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE',
          deleted: false
        },
        {
          projection: {
            _id: 1
          }
        });
    })
    .then(referenceData => {
      if (!referenceData) {
        console.log('No reference data item found in the system');
        return Promise.resolve(false);
      }

      // mark followup status as deleted
      console.log('The "Never ill / Not a Case" status was marked as deleted');
      return referenceDataCollection
        .updateOne({
          _id: referenceData._id
        }, {
          $set: {
            deleted: true,
            deletedAt: new Date()
          }
        });
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Disable a followUp status
 * @param callback
 */
const disableFollowUpStatus = (callback) => {
  // reference data collection
  let referenceDataCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      referenceDataCollection = dbConn.collection('referenceData');

      // get item
      return referenceDataCollection
        .findOne({
          _id: 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_DIED',
          categoryId: 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE',
          active: true
        },
        {
          projection: {
            _id: 1
          }
        });
    })
    .then(referenceData => {
      if (!referenceData) {
        console.log('No reference data item found in the system');
        return Promise.resolve(false);
      }

      // mark followup status as disabled
      console.log('The "Died" status will be marked as disabled');
      return referenceDataCollection
        .updateOne({
          _id: referenceData._id
        }, {
          $set: {
            active: false,
            updatedAt: new Date()
          }
        });
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  replaceFollowUpStatus,
  deleteFollowUpStatus,
  disableFollowUpStatus
};
