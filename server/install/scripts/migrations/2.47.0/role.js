'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Add "contact_list_isolated_contacts" permission for the following permissions: contact_convert_to_contact_of_contact, contact_delete
 */
const addMissingPermission = (callback) => {
  // constants
  const PERMISSION_CONTACT_CONVERT_TO_CONTACT_OF_CONTACT = 'contact_convert_to_contact_of_contact';
  const PERMISSION_CONTACT_DELETE = 'contact_delete';
  const PERMISSION_CONTACT_LIST_ISOLATED_CONTACTS = 'contact_list_isolated_contacts';

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
                PERMISSION_CONTACT_CONVERT_TO_CONTACT_OF_CONTACT,
                PERMISSION_CONTACT_DELETE
              ]
            }
          }, {
            'permissionIds': {
              $nin: [
                PERMISSION_CONTACT_LIST_ISOLATED_CONTACTS
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
        console.log('The missing role will be added in the following role: ' + data._id);

        // add missing permission to resulted roles
        return roleCollection
          .updateOne({
            _id: data._id
          }, {
            '$push': {
              permissionIds: PERMISSION_CONTACT_LIST_ISOLATED_CONTACTS
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
  addMissingPermission
};
