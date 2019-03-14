'use strict';

const app = require('../../server');
const common = require('./_common');
const Role = app.models.role;
const User = app.models.user;
const rewrite = false;
const defaultAdmin = {
  firstName: 'System',
  lastName: 'Administrator',
  email: 'admin@who.int',
  password: 'admin',
  languageId: 'english_us',
  passwordChange: true
};
const rolesMap = {
  'System administrator': {
    description: 'This is a built in role that manages user accounts, and configuration of the system.',
    permissionIds: [
      'read_sys_config',
      'write_sys_config',
      'read_role',
      'write_role',
      'read_user_account',
      'write_user_account',
      'read_outbreak'
    ]
  },
  'GO.Data administrator': {
    description: 'This role has access to configuration of the Go.Data for specific outbreak.',
    permissionIds: [
      'read_outbreak',
      'write_outbreak',
      'write_reference_data',
      'read_sys_config',
      'write_sys_config'
    ]
  },
  'Epidemiologist': {
    description: 'This is a built in role that analyses data to understand disease evolution and inform response.',
    permissionIds: [
      'read_outbreak',
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_followup',
      'write_followup',
      'read_sys_config',
      'read_report'
    ]
  },
  'Data manager': {
    description: 'This is a built in role that provides support and coordinates the collection of all data related to the outbreak.',
    permissionIds: [
      'read_outbreak',
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_followup',
      'write_followup',
      'read_sys_config',
      'read_report'
    ]
  },
  'Contact tracing coordinator': {
    description: 'This is a built in role that coordinates the work of multiple Contact Tracers.',
    permissionIds: [
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_followup',
      'write_followup',
      'read_outbreak',
      'read_sys_config',
      'read_team',
      'write_team',
      'read_report',
      'read_user_account'
    ]
  },
  'Contact Tracer': {
    description: 'This is a built in role that follows up with contacts and monitors their health.',
    permissionIds: [
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_followup',
      'write_followup',
      'read_outbreak',
      'read_sys_config'
    ]
  },
  'Help content manager': {
    description: 'This is a built in role that manages content.',
    permissionIds: [
      'write_help',
      'approve_help'
    ]
  },
  'Language manager': {
    description: 'This is a built in role that manages languages.',
    permissionIds: [
      'read_sys_config',
      'write_sys_config'
    ]
  },
  'Reports and data viewer': {
    description: 'This is a built in role that manages reports.',
    permissionIds: [
      'read_report',
      'read_case',
      'read_contact',
      'read_outbreak',
      'read_sys_config'
    ]
  }
};

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
            name: roleName
          }
        })
        .then(function (role) {
          if (!role) {
            return Role
              .create(Object.assign({
                name: roleName,
                description: rolesMap[roleName].description,
                permissionIds: rolesMap[roleName].permissionIds
              }, common.install.timestamps), options)
              .then(function (role) {
                if (roleName === 'System Administrator') {
                  defaultAdmin.roleIds = [role.id];
                }
                return 'created.';
              });
          } else if (rewrite) {
            if (roleName === 'System Administrator') {
              defaultAdmin.roleIds = [role.id];
            }
            return role
              .updateAttributes({
                description: rolesMap[roleName].description,
                permissionIds: rolesMap[roleName].permissionIds
              }, options)
              .then(function () {
                return 'updated.';
              });
          } else {
            if (roleName === 'System Administrator') {
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
