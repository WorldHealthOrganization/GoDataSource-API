'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');

// roles map from model
const rolesMap = require('./defaultRoles');

// initialize migration error container
let migrationErrors = [];

/**
 * Migrate default roles
 * Set hardcoded IDs for existing default roles resources
 * Note: Migration will not stop on error. Will try to migrate all roles
 * @param mongoDBConnection Mongo DB connection
 * @returns {Promise<any[] | never>}
 */
function migrateRoles(mongoDBConnection) {
  // initialize map of roles that were updated to be used for updating all users with those roles
  const updatedRoles = {};

  // initialize raw mongoDB collection
  const Role = mongoDBConnection.collection('role');

  return Promise.all(Object.keys(rolesMap)
    .map(roleName => Role
      .findOne({
        name: roleName
      })
      .then(roleInstance => {
        if (!roleInstance) {
          // nothing to do; role is permanently deleted
          return 'skipped. Was permanently deleted.';
        }

        // role was found; check for ID
        if (roleInstance._id === rolesMap[roleName].id) {
          // nothing to do; role already has the hardcoded ID
          return 'skipped. Was already updated.';
        }

        // cache current role ID
        const currentRoleId = roleInstance._id;

        // role has old ID; need to update its ID with the hardcoded value and also add the role in the updated roles map
        // Note: MongoDB doesn't allow updating the ID. Need to create a new instance with the new ID and remove the old instance
        return Role
          .insertOne(
            Object.assign(roleInstance, {
              _id: rolesMap[roleName].id
            })
          )
          .then(() => {
            // created new instance with hardcoded role ID
            // remove the existing one
            return Role
              .deleteOne({
                _id: currentRoleId
              });
          })
          .then(() => {
            // new instance with hardcoded role ID was created and old instance was removed
            // add entry in updated roles map
            updatedRoles[currentRoleId] = rolesMap[roleName].id;
            return 'updated.';
          })
          .catch(err => {
            // error on either insert/deleteOne actions; Means that existing role is not altered
            // try to rollback insert if was successful
            Role
              .deleteOne({
                _id: rolesMap[roleName].id
              })
              .catch(err => {
                console.log(`DB error on role ${roleName} rollback. Error: ${err.message}`);
              });

            // add error in container
            migrationErrors.push(`Role ${roleName} not updated. Error: ${err.message}`);

            // return not updated status
            return `not updated. Error: ${err.message}`;
          });
      })
      .then(status => {
        console.log(`Role ${roleName} ${status}`);
      })
      .catch(err => {
        // add error in container
        let errMessage = `DB error when checking role ${roleName}. Error: ${err.message}`;
        migrationErrors.push(errMessage);
        console.log(errMessage);
      })
    ))
    .catch(() => {
      // nothing to do here
      // when there is an error it is already logged above in the catch for a single role
      // even though there were some errors, the successfully updated roles will be returned below
    })
    .then(() => {
      // role migration is finished; return updated roles to migrate associated users
      return updatedRoles;
    });
}

/**
 * Migrate users associated with updated roles
 * Set hardcoded IDs for existing in the roleIds of the users
 * Note: Migration will not stop on error. Will try to migrate all users
 * @param mongoDBConnection Mongo DB connection
 * @param updatedRoles Roles that were updated and need to be updated on related users
 * @returns {Promise<any[] | never>}
 */
function migrateUsers(mongoDBConnection, updatedRoles = {}) {
  // get updated roles old ID
  const oldRolesIDs = Object.keys(updatedRoles);

  // stop if there are not updated roles
  if (!oldRolesIDs.length) {
    return Promise.resolve();
  }

  // initialize raw mongoDB collection
  const User = mongoDBConnection.collection('user');

  // search for users that have any of the updated roles assigned
  return User
    .find({
      roleIds: {
        '$in': oldRolesIDs
      }
    })
    .toArray()
    .then(users => {
      if (!users.length) {
        // nothing to do; no users to updated
        console.log('No users need update');
        return Promise.resolve();
      }

      // loop through the users and create/execute update promise for each one
      return Promise.all(users
        .map(user => {
          // get user's current roles
          let currentRolesIds = user.roleIds;

          // replace the old IDs for the updated roles with the new hardcoded ones
          let newRolesIds = currentRolesIds.map(currentRoleId => {
            return updatedRoles[currentRoleId] ? updatedRoles[currentRoleId] : currentRoleId;
          });

          // update user with the new roles
          return User
            .updateOne({
              _id: user._id
            }, {
              '$set': {
                roleIds: newRolesIds
              }
            })
            .then(() => {
              console.log(`User '${user._id}' roles update success`);
            })
            .catch(err => {
              // add error in container; show old/new roleIds in order to allow a sys admin to manually update them
              let errMessage = `User '${user._id}' roles update error: ${err.message}. Old roleIds: ${JSON.stringify(currentRolesIds)}. New roleIds: ${JSON.stringify(newRolesIds)}`;
              migrationErrors.push(errMessage);
              // log error; we will continue process even though some user updates are failing
              console.log(errMessage);
            });
        })
      )
        .catch(() => {
          // nothing to do here
          // when there is an error it is already logged above in the catch for a single user
        });
    })
    .then(() => {
      // user migration is finished; return updated roles to migrate associated users
      console.log('User migration finished.');
    })
    .catch(err => {
      // add error in container
      let errMessage = `DB error when checking for users. Error: ${err.message}`;
      migrationErrors.push(errMessage);
      console.log(errMessage);
    });
}

/**
 * Run migration
 * Note: Migration will not stop on failed resource; it will try to migrate all resources no mather if some of them return errors
 * @param callback
 */
function run(callback) {
  // initialize mongoDB connection cache
  let mongoDBConnection;

  // create Mongo DB connection
  MongoDBHelper
    .getMongoDBConnection()
    .then(connection => {
      // cache connection
      mongoDBConnection = connection;
      // migrate roles
      return migrateRoles(mongoDBConnection);
    })
    .then(updatedRoles => {
      // update users that have the updated roles
      return migrateUsers(mongoDBConnection, updatedRoles);
    })
    .then(() => {
      console.log(`Migration complete ${migrationErrors.length ? `with errors: \n${migrationErrors.join('\n')}` : ''}.`);
      return callback();
    })
    .catch(callback);
}

module.exports = run;
