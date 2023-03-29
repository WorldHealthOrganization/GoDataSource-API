'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

/**
 * Add event_generate_visual_id permission for the following permission: event_create, event_modify and event_import
 */
const addMissingPermission = (callback) => {
  // constants
  const PERMISSION_EVENT_CREATE = 'event_create';
  const PERMISSION_EVENT_MODIFY = 'event_modify';
  const PERMISSION_EVENT_IMPORT = 'event_import';
  const PERMISSION_EVENT_GENERATE_VISUAL_ID = 'event_generate_visual_id';

  let roleCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collections
      roleCollection = dbConn.collection('role');

      // initialize parameters for handleActionsInBatches call
      const roleQuery = {
        deleted: false,
        $and: [
          {
            'permissionIds': {
              $in: [
                PERMISSION_EVENT_CREATE,
                PERMISSION_EVENT_MODIFY,
                PERMISSION_EVENT_IMPORT
              ]
            }
          }, {
            'permissionIds': {
              $nin: [
                PERMISSION_EVENT_GENERATE_VISUAL_ID
              ]
            }
          }
        ]
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count roles
        return roleCollection
          .countDocuments(roleQuery);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        // get records for batch
        return roleCollection
          .find(roleQuery, {
            skip: (batchNo - 1) * batchSize,
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
        console.log(`The missing role will be added in the following role: ${data._id}`)

        // add missing permission to resulted roles
        return roleCollection
          .updateMany({
            _id: data._id
          }, {
            '$push': {
              permissionIds: PERMISSION_EVENT_GENERATE_VISUAL_ID
            }
          });
      };

      // execute
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        1000,
        1,
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
  addMissingPermission
};
