'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Add "client_application_view" and "client_application_modify" permissions
 */
const addMissingPermission = (callback) => {
  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      // collections
      const roleCollection = dbConn.collection('role');

      // initialize parameters for handleActionsInBatches call
      const roleQuery = {
        'permissionIds': {
          $in: [
            'client_application_list',
            'client_application_create',
          ]
        }
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
            sort: {
              createdAt: 1
            },
            projection: {
              _id: 1,
              permissionIds: 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // determine what to add
        const permissionIds = data.permissionIds || [];
        const hasList = permissionIds.indexOf('client_application_list') > -1;
        const hasCreate = permissionIds.indexOf('client_application_create') > -1;
        const hasView = permissionIds.indexOf('client_application_view') > -1;
        const hasModify = permissionIds.indexOf('client_application_modify') > -1;

        // view
        let changed = false;
        if (
          !hasView && (
            hasList ||
            hasCreate
          )
        ) {
          // log
          console.log(`${data._id} added "client_application_view"`);

          // add view
          changed = true;
          permissionIds.push('client_application_view');
        }

        // modify
        if (
          !hasModify &&
          hasCreate
        ) {
          // log
          console.log(`${data._id} added "client_application_modify"`);

          // add view
          changed = true;
          permissionIds.push('client_application_modify');
        }

        // add missing permission to resulted roles
        return !changed ?
          Promise.resolve() :
          roleCollection
            .updateOne({
              _id: data._id
            }, {
              '$set': {
                permissionIds
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
        10,
        console
      );
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Replace "follow_up_create" permission with "contact_follow_up_create"
 */
const updateFollowUpPermissions = (callback) => {
  // collections
  let roleCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collections
      roleCollection = dbConn.collection('role');

      // initialize parameters for handleActionsInBatches call
      const roleQuery = {
        $and: [
          {
            'permissionIds': {
              $in: [
                'follow_up_create',
                'follow_up_all'
              ]
            }
          }, {
            'permissionIds': {
              $nin: [
                'contact_all'
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
        console.log('The "contact_follow_up_create" permission will be added to the following role: ' + data._id);

        // add missing permission to resulted roles
        return roleCollection
          .updateMany({
            _id: data._id
          }, {
            '$push': {
              permissionIds: 'contact_follow_up_create'
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

// export list of migration jobs; functions that receive a callback
module.exports = {
  addMissingPermission,
  updateFollowUpPermissions
};
