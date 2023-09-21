'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const _ = require('lodash');
const adminEmailConfig = require('../../../../config.json').adminEmail;
const localizationHelper = require('../../../../../components/localizationHelper');

// roles map from model
const rolesMap = require('../../defaultRoles');
const ADMIN_ID = 'sys_admin';
const ADMIN_EMAIL = adminEmailConfig || 'admin@who.int';
const defaultAdmin = {
  _id: ADMIN_ID,
  firstName: 'System',
  lastName: 'Administrator',
  email: ADMIN_EMAIL,
  password: 'admin',
  languageId: 'english_us',
  passwordChange: true,
  roleIds: [
    'ROLE_SYSTEM_ADMINISTRATOR',
    'ROLE_USER_MANAGER'
  ]
};

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
        $or: [
          {
            name: roleName
          }, {
            _id: rolesMap[roleName].id
          }
        ]
      })
      .then(roleInstance => {
        if (!roleInstance) {
          // role doesn't exist anymore, default roles should always be inm the system
          // create role
          const defaultRoleData = rolesMap[roleName];
          return Role
            .insertOne({
              _id: defaultRoleData.id,
              name: defaultRoleData.newName ?
                defaultRoleData.newName :
                roleName,
              description: defaultRoleData.description,
              permissionIds: defaultRoleData.permissionIds,
              deleted: false
            })
            .then(() => {
              // new instance created
              return 'created.';
            })
            .catch(err => {
              // return not created status
              return `not created. Error: ${err.message}`;
            });
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
      // if necessary update permissions to the default ones
      const defaultRoleIds = Object.keys(rolesMap).map((roleName) => rolesMap[roleName].id);

      // there is nothing to update ?
      if (
        !defaultRoleIds ||
        defaultRoleIds.length < 1
      ) {
        // log
        console.log('We don\'t need to check permissions for default user roles since there are none :)');

        // finished
        return null;
      }

      // log
      console.log(`Checking ${defaultRoleIds.length} roles permissions...`);

      // retrieve roles if necessary
      return Role
        .find({
          _id: {
            $in: defaultRoleIds
          }
        })
        .toArray()
        .catch((err) => {
          console.log(`DB error while trying to retrieve roles '${defaultRoleIds.join(', ')}'. Error: ${err.message}`);
        });
    })
    .then((rolesToCheckPermissions) => {
      // skip step ?
      if (rolesToCheckPermissions === null) {
        return;
      }

      // log
      console.log(`Found ${rolesToCheckPermissions.length} roles`);

      // map default roles for easy access
      const roleMap = {};
      Object.keys(rolesMap).forEach((roleName) => {
        const roleData = rolesMap[roleName];
        roleMap[roleData.id] = roleData;
      });

      // perform permissions check
      console.log('Checking roles...');
      const updateRolePermissions = [];
      rolesToCheckPermissions.forEach((roleData) => {
        // determine default role based on role id
        const mappedRole = roleMap[roleData._id];
        if (mappedRole) {
          // determine if we have the same permissions, if not...update to default permissions
          if (
            !roleData.migrateDate ||
            !roleData.permissionIds || (
              (
                roleData.permissionIds.length !== mappedRole.permissionIds.length ||
                _.find(roleData.permissionIds, permissionId => mappedRole.permissionIds.indexOf(permissionId) === -1) || (
                  mappedRole.newName &&
                  roleData.name !== mappedRole.newName
                )
              ) &&
              localizationHelper.toMoment(roleData.migrateDate).isBefore(localizationHelper.toMoment(mappedRole.migrateDate))
            )
          ) {
            // update role
            console.log(`Resetting role '${roleData._id}' permissions and name`);
            updateRolePermissions.push({
              id: roleData._id,
              permissionIds: mappedRole.permissionIds,
              name: mappedRole.newName,
              migrateDate: mappedRole.migrateDate
            });
          }
        }
      });

      // there is nothing to update ?
      if (updateRolePermissions.length < 1) {
        console.log('There is nothing to update');
        return;
      }

      // if necessary create promises to update user roles
      return Promise.all(
        updateRolePermissions.map((roleData) => Role
          .updateOne({
            _id: roleData.id
          }, {
            $set: !_.isEmpty(roleData.name) ? {
              permissionIds: roleData.permissionIds,
              name: roleData.name,
              migrateDate: roleData.migrateDate
            } : {
              permissionIds: roleData.permissionIds,
              migrateDate: roleData.migrateDate
            }
          })
        ))
        .catch((err) => {
          console.log(`DB error while trying to update roles. Error: ${err.message}`);
        });
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
      // initialize raw mongoDB collection
      const User = mongoDBConnection.collection('user');

      // reset sys-admin user roles
      // make sure he has both use roles - reset sys admin
      return User
        .findOne({
          _id: ADMIN_ID
        })
        .then((userData) => {
          // if not found..then we need to create it
          if (!userData) {
            console.log('Sys admin user not found');
            return User
              .insertOne(defaultAdmin)
              .then(() => {
                console.log('Sys admin user created');
              })
              .catch(err => {
                // return not created status
                console.log(`Error creating sys admin user: ${err.message}`);
              });
          }

          // found, we need to update user roles
          const newRolesIds = _.uniq([
            ...(userData.roleIds ? userData.roleIds : []),
            ...defaultAdmin.roleIds
          ]);

          // do we need to reset sys admin data ?
          if (_.isEqual(newRolesIds, userData.roleIds)) {
            console.log('No need to reset sys admin');
            return;
          }

          // reset sys admin data
          return User
            .updateOne({
              _id: ADMIN_ID
            }, {
              '$set': {
                roleIds: newRolesIds
              }
            })
            .then(() => {
              console.log('Sys admin updated');
            })
            .catch(err => {
              // add error
              let errMessage = `Sys admin role update error: ${err.message}.`;
              migrationErrors.push(errMessage);
              // log error
              console.log(errMessage);
            });
        })
        .catch((err) => {
          // add error
          let errMessage = `Sys admin role update error: ${err.message}.`;
          migrationErrors.push(errMessage);
          // log error
          console.log(errMessage);
        });
    })
    .then(() => {
      console.log(`Migration complete ${migrationErrors.length ? `with errors: \n${migrationErrors.join('\n')}` : ''}.`);
      return callback();
    })
    .catch(callback);
}

module.exports = {
  run
};
