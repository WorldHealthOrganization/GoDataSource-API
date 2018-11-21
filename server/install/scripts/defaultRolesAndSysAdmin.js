'use strict';

const app = require('../../server');
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
  'System Administrator': {
    description: 'This is a built in role that manages user accounts, and configuration of the system.',
    permissionIds: [
      'read_sys_config',
      'write_sys_config',
      'write_reference_data',
      'read_user_account',
      'write_user_account',
      'read_role',
      'write_role',
      'write_help',
      'approve_help',
      'read_outbreak'
    ]
  },
  'GO.Data Administrator': {
    description: 'This role has access to configuration of the Go.Data for specific outbreak.',
    permissionIds: [
      'read_outbreak',
      'write_outbreak',
      'write_help',
      'approve_help'
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
      'read_report'
    ]
  },
  'Data Manager': {
    description: 'This is a built in role that provides support and coordinates the collection of all data related to the outbreak.',
    permissionIds: [
      'read_outbreak',
      'write_outbreak',
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_report',
      'read_followup'
    ]
  },
  'Contact Tracing Team Lead': {
    description: 'This is a built in role that coordinates the work of multiple Contact Tracers.',
    permissionIds: [
      'read_outbreak',
      'read_report',
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_team',
      'write_team'
    ]
  },
  'Contact Tracer': {
    description: 'This is a built in role that follows up with contacts and monitors their health.',
    permissionIds: [
      'read_outbreak',
      'read_case',
      'write_case',
      'read_contact',
      'write_contact',
      'read_followup',
      'write_followup'
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
              .create({
                name: roleName,
                description: rolesMap[roleName].description,
                permissionIds: rolesMap[roleName].permissionIds
              }, options)
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
              .create(defaultAdmin, options)
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
