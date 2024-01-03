'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Number of find requests at the same time
// Don't set this value to high, so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Copy contact follow-up settings to case follow-up settings
 */
const updateCaseFollowUpSettings = (callback) => {
  // create Mongo DB connection
  let outbreakCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count records that we need to update
        return outbreakCollection
          .countDocuments();
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        return outbreakCollection
          .find({}, {
            // always getting the first items as the already modified ones are filtered out
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              _id: 1,
              generateFollowUpsTeamAssignmentAlgorithm: 1,
              generateFollowUpsOverwriteExisting: 1,
              generateFollowUpsKeepTeamAssignment: 1,
              periodOfFollowup: 1,
              frequencyOfFollowUpPerDay: 1,
              intervalOfFollowUp: 1,
              generateFollowUpsDateOfLastContact: 1,
              generateFollowUpsWhenCreatingContacts: 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // update
        return outbreakCollection
          .updateOne({
            _id: data._id
          }, {
            $set: {
              allowCasesFollowUp: false,
              generateFollowUpsTeamAssignmentAlgorithmCases: data.generateFollowUpsTeamAssignmentAlgorithm,
              generateFollowUpsOverwriteExistingCases: data.generateFollowUpsOverwriteExisting,
              generateFollowUpsKeepTeamAssignmentCases: data.generateFollowUpsKeepTeamAssignment,
              periodOfFollowupCases: data.periodOfFollowup,
              frequencyOfFollowUpPerDayCases: data.frequencyOfFollowUpPerDay,
              intervalOfFollowUpCases: data.intervalOfFollowUp,
              generateFollowUpsDateOfOnset: data.generateFollowUpsDateOfLastContact,
              generateFollowUpsWhenCreatingCases: data.generateFollowUpsWhenCreatingContacts
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
  updateCaseFollowUpSettings
};
