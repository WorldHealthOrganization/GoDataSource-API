'use strict';

const app = require('../../server/server');

module.exports = function (Role) {
  // set flag to force using the controller
  Role.hasController = true;

  Role.availablePermissions = {
    read_sys_config: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_SYS_CONFIG',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_SYS_CONFIG_DESCRIPTION'
    },
    write_sys_config: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_SYS_CONFIG',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_SYS_CONFIG_DESCRIPTION'
    },
    write_reference_data: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_REFERENCE_DATA',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_REFERENCE_DATA_DESCRIPTION'
    },
    read_user_account: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT_DESCRIPTION'
    },
    write_user_account: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT_DESCRIPTION'
    },
    read_role: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_ROLE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_ROLE_DESCRIPTION'
    },
    write_role: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_ROLE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_ROLE_DESCRIPTION'
    },
    read_outbreak: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK_DESCRIPTION'
    },
    write_outbreak: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK_DESCRIPTION'
    },
    read_team: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_TEAM',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_TEAM_DESCRIPTION'
    },
    write_team: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_TEAM',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_TEAM_DESCRIPTION'
    },
    read_report: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_REPORT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_REPORT_DESCRIPTION'
    },
    read_case: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CASE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CASE_DESCRIPTION'
    },
    write_case: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CASE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CASE_DESCRIPTION'
    },
    read_contact: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT_DESCRIPTION'
    },
    write_contact: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT_DESCRIPTION'
    },
    read_followup: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_FOLLOW_UP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_FOLLOW_UP_DESCRIPTION'
    },
    write_followup: {
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_FOLLOW_UP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_FOLLOW_UP_DESCRIPTION'
    }
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
