'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const templateDefinition = require('../../../../../common/models/template.json');

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
  let templateCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      templateCollection = dbConn.collection('template');

      // initialize filter
      // - update deleted items too
      // - update only items that don't have default data
      let templateFilter = {
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
        return templateCollection
          .countDocuments(templateFilter);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        return templateCollection
          .find(templateFilter, {
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
          setData.generateFollowUpsOverwriteExisting = templateDefinition.properties.generateFollowUpsOverwriteExisting.default;
        }

        // generateFollowUpsKeepTeamAssignment
        if (data.generateFollowUpsKeepTeamAssignment === undefined) {
          setData.generateFollowUpsKeepTeamAssignment = templateDefinition.properties.generateFollowUpsKeepTeamAssignment.default;
        }

        // generateFollowUpsTeamAssignmentAlgorithm
        if (data.generateFollowUpsTeamAssignmentAlgorithm === undefined) {
          setData.generateFollowUpsTeamAssignmentAlgorithm = templateDefinition.properties.generateFollowUpsTeamAssignmentAlgorithm.default;
        }

        // isContactLabResultsActive
        if (data.isContactLabResultsActive === undefined) {
          setData.isContactLabResultsActive = templateDefinition.properties.isContactLabResultsActive.default;
        }

        // isContactsOfContactsActive
        if (data.isContactsOfContactsActive === undefined) {
          setData.isContactsOfContactsActive = templateDefinition.properties.isContactsOfContactsActive.default;
        }

        // applyGeographicRestrictions
        if (data.applyGeographicRestrictions === undefined) {
          setData.applyGeographicRestrictions = templateDefinition.properties.applyGeographicRestrictions.default;
        }

        // update
        return templateCollection
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
