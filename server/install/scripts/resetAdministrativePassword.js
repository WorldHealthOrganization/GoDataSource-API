'use strict';

const _ = require('lodash');
const app = require('../../server');
const Role = app.models.role;
const User = app.models.user;

const defaultAdmin = {
  firstName: 'System',
  lastName: 'Administrator',
  email: 'admin@who.int',
  password: 'admin',
  passwordChange: true
};

const defaultSystemAdminRole = {
  name: 'System Administrator',
  description: 'This is a built in role that manages user accounts, and configuration of the system.',
  permissionIds: [
    'read_sys_config',
    'write_sys_config',
    'write_reference_data',
    'read_user_account',
    'write_user_account',
    'read_role',
    'write_role'
  ]
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // try to find built-in system admin role
  Role
    .findOne({
      where: {
        name: defaultSystemAdminRole.name
      }
    })
    .then(function (systemAdminRole) {
      // no default system admin role found
      if (!systemAdminRole) {
        // log role missing
        console.warn('Could not find default system admin role, it will be re-created');
        // create it
        return Role.create(defaultSystemAdminRole);
      }
      // system admin role found, check if it has all the default permissions
      let hasAllPermissions = true;
      defaultSystemAdminRole.permissionIds.forEach(function (permission) {
        if (systemAdminRole.permissionIds.indexOf(permission) === -1) {
          // found missing permission
          hasAllPermissions = false;
        }
      });
      // if the role does not have all permissions
      if (!hasAllPermissions) {
        // log missing permissions
        console.warn('Default system admin role is missing some default permissions, it will be updated');
        // update it to contain missing permissions
        return systemAdminRole.updateAttributes({
          permissionIds: _.uniq(systemAdminRole.permissionIds.concat(defaultSystemAdminRole.permissionIds))
        });
      }
      return systemAdminRole;
    })
    .then(function (systemAdminRole) {
      // try to find system admin user
      return User
        .findOne({
          where: {
            email: defaultAdmin.email
          }
        })
        .then(function (systemAdmin) {
          // system admin was not found
          if (!systemAdmin) {
            // log role missing
            console.warn('Could not find default system admin user, it will be re-created');
            // re-create it
            return User.create(Object.assign(defaultAdmin, {roleIds: [systemAdminRole.id]}));
          }
          // system admin was found, check if it has system admin role assigned
          if (systemAdmin.roleIds.indexOf(systemAdminRole.id) === -1) {
            // if it does not, update roles and set default password
            return systemAdmin.updateAttributes({
              roleIds: systemAdmin.roleIds.concat([systemAdminRole.id]),
              password: defaultAdmin.password,
              passwordChange: true
            });
          }
          // system admin has all the required permissions, update only the password
          return systemAdmin.updateAttributes({
            password: defaultAdmin.password,
            passwordChange: true
          });
        })
    })
    .then(function () {
      console.log(`Administrative password was reset`);
      callback();
    })
    .catch(callback);
}

module.exports = run;
