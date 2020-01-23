'use strict';

const app = require('../../server');
const common = require('./_common');
const Role = app.models.role;
const User = app.models.user;
const rewrite = false;
const defaultAdmin = {
  id: 'sys_admin',
  firstName: 'System',
  lastName: 'Administrator',
  email: 'admin@who.int',
  password: 'admin',
  languageId: 'english_us',
  passwordChange: true
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
              .then(function (role) {
                if (roleName === 'System administrator') {
                  defaultAdmin.roleIds = [role.id];
                }
                return 'created.';
              });
          } else if (rewrite) {
            if (roleName === 'System administrator') {
              defaultAdmin.roleIds = [role.id];
            }
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
            if (roleName === 'System administrator') {
              defaultAdmin.roleIds = [role.id];
            }
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

  initRolesCreation();

  /**
   * Create default System Admin accounts
   */
  Promise.all(createRoles)
    .then(function () {
      return User
        .findOne({
          where: {
            email: defaultAdmin.email
          }
        })
        .then(function (user) {
          if (!user) {
            return User
              .create(Object.assign(defaultAdmin, common.install.timestamps), options)
              .then(function () {
                return 'created.';
              });
          } else if (rewrite) {
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
