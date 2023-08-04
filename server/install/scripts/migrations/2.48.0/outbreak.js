'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const outbreakDefinition = require('../../../../../common/models/outbreak.json');

// Number of find requests at the same time
// Don't set this value to high, so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Add missing sort keys to language tokens
 * @param callback
 */
const addMissingDefaultValues = (callback) => {
  // create Mongo DB connection
  let outbreakCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');

      // initialize filter
      // - update deleted items too
      // - update only items that don't have default data
      let outbreakFilter = {
        $or: [{
          eventIdMask: {
            $exists: false
          }
        }, {
          eventIdMask: {
            $eq: null
          }
        }, {
          eventIdMask: {
            $eq: ''
          }
        }, {
          caseIdMask: {
            $exists: false
          }
        }, {
          caseIdMask: {
            $eq: null
          }
        }, {
          caseIdMask: {
            $eq: ''
          }
        }, {
          contactIdMask: {
            $exists: false
          }
        }, {
          contactIdMask: {
            $eq: null
          }
        }, {
          contactIdMask: {
            $eq: ''
          }
        }, {
          contactOfContactIdMask: {
            $exists: false
          }
        }, {
          contactOfContactIdMask: {
            $eq: null
          }
        }, {
          contactOfContactIdMask: {
            $eq: ''
          }
        }]
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count records that we need to update
        return outbreakCollection
          .countDocuments(outbreakFilter);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        return outbreakCollection
          .find(outbreakFilter, {
            // always getting the first items as the already modified ones are filtered out
            skip: 0,
            limit: batchSize,
            projection: {
              _id: 1,
              name: 1,
              eventIdMask: 1,
              caseIdMask: 1,
              contactIdMask: 1,
              contactOfContactIdMask: 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // set data
        const setData = {};

        // eventIdMask
        if (!data.eventIdMask) {
          // set data
          setData.eventIdMask = outbreakDefinition.properties.eventIdMask.default;

          // log
          console.log(`Updating eventIdMask for outbreak '${data.name}' to '${outbreakDefinition.properties.eventIdMask.default}'`);
        }

        // caseIdMask
        if (!data.caseIdMask) {
          // set data
          setData.caseIdMask = outbreakDefinition.properties.caseIdMask.default;

          // log
          console.log(`Updating caseIdMask for outbreak '${data.name}' to '${outbreakDefinition.properties.caseIdMask.default}'`);
        }

        // contactIdMask
        if (!data.contactIdMask) {
          // set data
          setData.contactIdMask = outbreakDefinition.properties.contactIdMask.default;

          // log
          console.log(`Updating contactIdMask for outbreak '${data.name}' to '${outbreakDefinition.properties.contactIdMask.default}'`);
        }

        // contactOfContactIdMask
        if (!data.contactOfContactIdMask) {
          // set data
          setData.contactOfContactIdMask = outbreakDefinition.properties.contactOfContactIdMask.default;

          // log
          console.log(`Updating contactOfContactIdMask for outbreak '${data.name}' to '${outbreakDefinition.properties.contactOfContactIdMask.default}'`);
        }

        // update
        return outbreakCollection
          .updateOne({
            _id: data._id
          }, {
            $set: setData
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
  addMissingDefaultValues
};
