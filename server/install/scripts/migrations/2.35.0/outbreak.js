'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const outbreakDefinition = require('../../../../../common/models/outbreak.json');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
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
          generateFollowUpsOverwriteExisting: {
            $exists: false
          }
        }, {
          generateFollowUpsKeepTeamAssignment: {
            $exists: false
          }
        }, {
          generateFollowUpsTeamAssignmentAlgorithm: {
            $exists: false
          }
        }, {
          isContactLabResultsActive: {
            $exists: false
          }
        }, {
          isContactsOfContactsActive: {
            $exists: false
          }
        }, {
          applyGeographicRestrictions: {
            $exists: false
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
              generateFollowUpsOverwriteExisting: 1,
              generateFollowUpsKeepTeamAssignment: 1,
              generateFollowUpsTeamAssignmentAlgorithm: 1,
              isContactLabResultsActive: 1,
              isContactsOfContactsActive: 1,
              applyGeographicRestrictions: 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // determine what we need to update
        const setData = {};

        // generateFollowUpsOverwriteExisting
        if (data.generateFollowUpsOverwriteExisting === undefined) {
          setData.generateFollowUpsOverwriteExisting = outbreakDefinition.properties.generateFollowUpsOverwriteExisting.default;
        }

        // generateFollowUpsKeepTeamAssignment
        if (data.generateFollowUpsKeepTeamAssignment === undefined) {
          setData.generateFollowUpsKeepTeamAssignment = outbreakDefinition.properties.generateFollowUpsKeepTeamAssignment.default;
        }

        // generateFollowUpsTeamAssignmentAlgorithm
        if (data.generateFollowUpsTeamAssignmentAlgorithm === undefined) {
          setData.generateFollowUpsTeamAssignmentAlgorithm = outbreakDefinition.properties.generateFollowUpsTeamAssignmentAlgorithm.default;
        }

        // isContactLabResultsActive
        if (data.isContactLabResultsActive === undefined) {
          setData.isContactLabResultsActive = outbreakDefinition.properties.isContactLabResultsActive.default;
        }

        // isContactsOfContactsActive
        if (data.isContactsOfContactsActive === undefined) {
          setData.isContactsOfContactsActive = outbreakDefinition.properties.isContactsOfContactsActive.default;
        }

        // applyGeographicRestrictions
        if (data.applyGeographicRestrictions === undefined) {
          setData.applyGeographicRestrictions = outbreakDefinition.properties.applyGeographicRestrictions.default;
        }

        // update
        return outbreakCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': setData
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
