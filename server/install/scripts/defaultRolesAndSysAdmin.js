'use strict';

const app = require('../../server');
const adminEmailConfig = require('../../config.json').adminEmail;
const common = require('./_common');
const Role = app.models.role;
const User = app.models.user;
const rewrite = false;
const ADMIN_ID = 'sys_admin';
const ADMIN_EMAIL = adminEmailConfig || 'admin@who.int';
const defaultAdmin = {
  id: ADMIN_ID,
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
const rolesMap = require('./defaultRoles');

const createRoles = [];

// initialize action options; set _init flag to prevent execution of some after save scripts
let options = {
  _init: true
};

/**
 * Create default roles
 */
function initRolesCreation() {
  Object.keys(rolesMap).forEach(function (roleName) {
    createRoles.push(
      Role
        .findOne({
          where: {
            $or: [
              {
                name: roleName
              }, {
                _id: rolesMap[roleName].id
              }
            ]
          }
        })
        .then(function (role) {
          if (!role) {
            return Role
              .create(Object.assign({
                id: rolesMap[roleName].id,
                name: rolesMap[roleName].newName ? rolesMap[roleName].newName : roleName,
                description: rolesMap[roleName].description,
                permissionIds: rolesMap[roleName].permissionIds,
                migrateDate: rolesMap[roleName].migrateDate
              }, common.install.timestamps), options)
              .then(function () {
                return 'created.';
              });
          } else if (rewrite) {
            return role
              .updateAttributes({
                name: rolesMap[roleName].newName ? rolesMap[roleName].newName : role.name,
                description: rolesMap[roleName].description,
                permissionIds: rolesMap[roleName].permissionIds,
                migrateDate: rolesMap[roleName].migrateDate
              }, options)
              .then(function () {
                return 'updated.';
              });
          } else {
            return 'skipped. Role already exists.';
          }
        })
        .then(function (status) {
          console.log(`Role ${roleName} ${status}`);
        })
    );
  });
}


/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // init
  initRolesCreation();

  // Create default System Admin accounts
  Promise.all(createRoles)
    .then(function () {
      return User
        .find({
          where: {
            $or: [
              {
                email: {
                  $in: [
                    ADMIN_EMAIL,
                    'admin@who.int'
                  ]
                }
              }, {
                _id: ADMIN_ID
              }
            ]
          }
        })
        .then(function (users) {
          // error - found multiple matching users with same admin credentials ?
          if (users.length > 1) {
            app.logger.error(`Multiple admin accounts found (id: "${ADMIN_ID}", email1: "${ADMIN_EMAIL}", email2: "admin@who.int"). Probably config.json isn't configured properly`);
            throw new app.utils.apiError.getError('ADMIN_ACCOUNT_CONFLICT');
          }

          // create / update user
          const user = users.length > 0 ?
            users[0] :
            null;
          if (!user) {
            return User
              .create(Object.assign(defaultAdmin, common.install.timestamps), options)
              .then(function () {
                return 'created.';
              });
          } else if (rewrite) {
            // different id ?
            if (user._id !== ADMIN_ID) {
              return User
                .rawBulkHardDelete({
                  _id: user._id
                })
                .then(() => {
                  return User
                    .create(Object.assign(defaultAdmin, common.install.timestamps), options)
                    .then(function () {
                      return 'deleted and created.';
                    });
                });
            }

            // update user
            return user
              .updateAttributes(defaultAdmin, options)
              .then(function () {
                return 'updated.';
              });
          } else {
            return 'skipped. User already exists.';
          }
        })
        .then(function (status) {
          console.log(`Default System Administrator user ${status}`);
          callback();
        })
        .catch(callback);
    });
}

module.exports = run;
