'use strict';

const app = require('../../server/server');

module.exports = function (Role) {
  // set flag to force using the controller
  Role.hasController = true;

  Role.availablePermissions = {
    read_sys_config: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_SYS_CONFIG',
    write_sys_config: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_SYS_CONFIG',
    write_reference_data: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_REFERENCE_DATA',
    read_user_account: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT',
    write_user_account: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT',
    read_role: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_ROLE',
    write_role: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_ROLE',
    read_outbreak: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK',
    write_outbreak: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK',
    read_team: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_TEAM',
    write_team: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_TEAM',
    read_report: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_REPORT',
    read_case: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CASE',
    write_own_case: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OWN_CASE',
    write_case: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CASE',
    read_contact: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT',
    write_own_contact: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OWN_CONTACT',
    write_contact: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT',
    read_followup: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_FOLLOW_UP',
    write_followup: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_FOLLOW_UP'
  };

  /**
   * Check the list of assigned permissions, make sure they are all valid
   */
  Role.validate('permissions', function available(error) {
    const allowedPermissions = Object.keys(Role.availablePermissions);
    const disallowedPermissions = [];
    this.permissions.forEach(function (permission) {
      if (allowedPermissions.indexOf(permission) === -1) {
        disallowedPermissions.push(permission);
      }
      if (disallowedPermissions.length) {
        error();
      }
    });
  }, {message: `at least one permission is invalid. Available permissions: "${Object.keys(Role.availablePermissions).join('", "')}"`});
};
