'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Add event_generate_visual_id permission for the following permission: event_create, event_modify and event_import
 */
const addMissingPermission = (callback) => {
  // constants
  const PERMISSION_EVENT_CREATE = 'event_create';
  const PERMISSION_EVENT_MODIFY = 'event_modify';
  const PERMISSION_EVENT_IMPORT = 'event_import';
  const PERMISSION_EVENT_GENERATE_VISUAL_ID = 'event_generate_visual_id';

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      // collections
      const roleCollection = dbConn.collection('role');

      // add missing permission to required roles
      return roleCollection
        .find({
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
        }, {
          projection: {
            _id: 1
          }
        })
        .toArray()
        .then((results) => {
          if (results.length < 1) {
            console.log(`No role found to update`);
            return callback();
          } else {
            const roleIds = [];
            results.forEach((result) => {
              roleIds.push(result['_id']);
            });

            // log
            console.log(`The following roles will be updated: ` + roleIds);

            // add missing permission to resulted roles
            return roleCollection
              .updateMany({
                _id: {
                  $in: roleIds
                }
              }, {
                '$push': {
                  permissionIds: PERMISSION_EVENT_GENERATE_VISUAL_ID
                }
              })
              .then(() => {
                // log
                console.log(`The roles were successfully updated`);

                // finished
                callback();
              })
              .catch(callback);
          }
        })
        .catch(callback);
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  addMissingPermission
};
