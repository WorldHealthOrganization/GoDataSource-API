'use strict';

const _ = require('lodash');
const app = require('../../server');
const adminEmailConfig = require('../../config.json').adminEmail;
const Role = app.models.role;
const User = app.models.user;
const rolesMap = require('./defaultRoles');
const async = require('async');

const ADMIN_ID = 'sys_admin';
const ADMIN_EMAIL = adminEmailConfig || 'admin@who.int';
const defaultAdmin = {
  id: ADMIN_ID,
  firstName: 'System',
  lastName: 'Administrator',
  email: ADMIN_EMAIL,
  password: 'admin',
  languageId: 'english_us',
  passwordChange: true
};

const defaultAdminRoles = {
  ROLE_SYSTEM_ADMINISTRATOR: true,
  ROLE_USER_MANAGER: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // find admin role & roleName
  let adminRoles = [];
  _.each(rolesMap || [], (roleData, name) => {
    // found ?
    if (defaultAdminRoles[roleData.id]) {
      adminRoles.push({
        name: name,
        role: roleData
      });
    }
  });

  // try to find built-in system admin role
  Role
    .find({
      where: {
        _id: {
          in: adminRoles.map(data => data.role.id)
        }
      }
    })
    .then(function (systemAdminRoles) {
      // create / update roles
      const foundRoles = {};
      (systemAdminRoles || []).forEach((role) => {
        foundRoles[role.id] = role;
      });

      // update create jobs
      const jobs = [];
      adminRoles.forEach((data) => {
        // create / update
        if (!foundRoles[data.role.id]) {
          // create role
          jobs.push((cb) => {
            // log role missing
            console.warn(`Could not find '${data.role.id}' role, it will be re-created`);

            // create role
            Role
              .create({
                id: data.role.id,
                name: data.role.newName ?
                  data.role.newName :
                  data.name,
                description: data.role.description,
                permissionIds: data.role.permissionIds
              })
              .then(() => {
                // log
                console.warn(`Role '${data.role.id}' created`);

                // finished
                cb();
              })
              .catch(cb);
          });
        } else {
          // system admin role found, check if it has all the default permissions
          let hasAllPermissions = data.role.permissionIds.length === foundRoles[data.role.id].permissionIds.length;
          if (hasAllPermissions) {
            foundRoles[data.role.id].permissionIds.forEach(function (permission) {
              if (data.role.permissionIds.indexOf(permission) === -1) {
                // found missing permission
                hasAllPermissions = false;
              }
            });
          }

          // if the role does not have all permissions
          if (!hasAllPermissions) {
            // update role
            jobs.push((cb) => {
              // log missing permissions
              console.warn(`Role '${data.role.id}' is missing some default permissions, it will be updated`);

              // update it to contain missing permissions
              foundRoles[data.role.id]
                .updateAttributes({
                  permissionIds: data.role.permissionIds
                    .filter((permission) => {
                      return Role.allAllowedPermissions.indexOf(permission) !== -1;
                    })
                })
                .then(() => {
                  // log
                  console.warn(`Role '${data.role.id}' updated`);

                  // finished
                  cb();
                })
                .catch(cb);
            });
          }
        }
      });

      // create / update roles
      if (jobs.length < 1) {
        // nothing to do, all roles are up to date
        return adminRoles;
      } else {
        // start create / update jobs
        return new Promise((resolve, reject) => {
          // wait for all operations to be done
          async.parallelLimit(jobs, 10, function (error) {
            // error
            if (error) {
              return reject(error);
            }

            // finished
            resolve(adminRoles);
          });
        });
      }
    })
    .then(function () {
      // try to find system admin user
      return User
        .find({
          where: {
            email: {
              inq: [
                ADMIN_EMAIL,
                'admin@who.int'
              ]
            }
          }
        })
        .then(function (systemAdmins) {
          // error - found multiple matching users with same admin credentials ?
          if (systemAdmins.length > 1) {
            app.logger.error(`Multiple admin accounts found (id: "${ADMIN_ID}", email1: "${ADMIN_EMAIL}", email2: "admin@who.int"). Probably config.json isn't configured properly`);
            throw new app.utils.apiError.getError('ADMIN_ACCOUNT_CONFLICT');
          }

          // system admin was not found
          const systemAdmin = systemAdmins.length > 0 ?
            systemAdmins[0] :
            null;
          if (!systemAdmin) {
            // log role missing
            console.warn('Could not find default system admin user, it will be re-created');

            // re-create it
            return User.create(Object.assign(
              defaultAdmin, {
                roleIds: adminRoles.map(data => data.role.id)
              }
            ));
          }

          // update user roles & reset password
          return Promise.all([
            systemAdmin.updateAttributes({
              roleIds: _.uniq(systemAdmin.roleIds.concat(adminRoles.map(data => data.role.id)))
            }),
            systemAdmin.updateAttributes({
              password: defaultAdmin.password,
              passwordChange: true
            }, { skipOldPasswordCheck: true, skipSamePasswordCheck: true })
          ]);
        });
    })
    .then(function () {
      console.log('Administrative password was reset');
      callback();
    })
    .catch(callback);
}

module.exports = run;
