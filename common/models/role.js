'use strict';

const app = require('../../server/server');

module.exports = function (Role) {
  // set flag to force using the controller
  Role.hasController = true;

  // define a list of custom (non-loopback-supported) relations
  Role.customRelations = {
    permissions: {
      type: 'function',
      fn: function (instance) {
        return new Promise(function (resolve) {
          let permissions = [];
          // if the role has a list of permission IDs
          if (instance.permissionIds && instance.permissionIds.length) {
            // go through the permissions and populate the list
            Role.availablePermissions.forEach(function (permission) {
              if (instance.permissionIds.indexOf(permission.id) !== -1) {
                permissions.push(permission);
              }
            });
          }
          resolve(permissions);
        });
      }
    }
  };

  Role.availablePermissions = [
    {
      id: 'read_sys_config',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_SYS_CONFIG',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_SYS_CONFIG_DESCRIPTION'
    },
    {
      id: 'write_sys_config',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_SYS_CONFIG',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_SYS_CONFIG_DESCRIPTION'
    },
    {
      id: 'write_reference_data',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_REFERENCE_DATA',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_REFERENCE_DATA_DESCRIPTION'
    },
    {
      id: 'read_user_account',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT_DESCRIPTION'
    },
    {
      id: 'write_user_account',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT_DESCRIPTION'
    },
    {
      id: 'read_role',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_ROLE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_ROLE_DESCRIPTION'
    },
    {
      id: 'write_role',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_ROLE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_ROLE_DESCRIPTION'
    },
    {
      id: 'read_outbreak',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK_DESCRIPTION'
    },
    {
      id: 'write_outbreak',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK_DESCRIPTION'
    },
    {
      id: 'read_team',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_TEAM',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_TEAM_DESCRIPTION'
    },
    {
      id: 'write_team',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_TEAM',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_TEAM_DESCRIPTION'
    },
    {
      id: 'read_report',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_REPORT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_REPORT_DESCRIPTION'
    },
    {
      id: 'read_case',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CASE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CASE_DESCRIPTION'
    },
    {
      id: 'write_case',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CASE',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CASE_DESCRIPTION'
    },
    {
      id: 'read_contact',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT_DESCRIPTION'
    },
    {
      id: 'write_contact',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT_DESCRIPTION'
    },
    {
      id: 'read_followup',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_FOLLOW_UP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_FOLLOW_UP_DESCRIPTION'
    },
    {
      id: 'write_followup',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_FOLLOW_UP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_FOLLOW_UP_DESCRIPTION'
    }
  ];

  Role.availablePermissionsKeys = Role.availablePermissions.map(function(permission) {
    return permission.id;
  });

  /**
   * Check the list of assigned permissionIds, make sure they are all valid
   */
  Role.validate('permissionIds', function available(error) {
    const allowedPermissions = Role.availablePermissionsKeys;
    const disallowedPermissions = [];
    this.permissionIds && Array.isArray(this.permissionIds) && this.permissionIds.forEach(function (permission) {
      if (allowedPermissions.indexOf(permission) === -1) {
        disallowedPermissions.push(permission);
      }
      if (disallowedPermissions.length) {
        error();
      }
    });
  }, {message: `at least one permission is invalid. Available permissions: "${Role.availablePermissionsKeys.join('", "')}"`});
};
