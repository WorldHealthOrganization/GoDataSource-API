'use strict';

module.exports = function (Role) {
  // set flag to force using the controller
  Role.hasController = true;

  // define the special permission used to validate client applications
  Role.clientApplicationPermission = '$client_application';

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
    // Event
    {
      id: 'event_view',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_VIEW_DESCRIPTION'
    },
    {
      id: 'event_list',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_DESCRIPTION'
    },
    {
      id: 'event_create',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_DESCRIPTION'
    },
    {
      id: 'event_modify',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_DESCRIPTION'
    },
    {
      id: 'event_delete',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_DESCRIPTION'
    },
    {
      id: 'event_restore',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_EVENT_DESCRIPTION'
    },
    {
      id: 'event_create_contact',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_EVENT_DESCRIPTION'
    },
    {
      id: 'event_create_bulk_contact',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_EVENT',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_EVENT_DESCRIPTION'
    },
    {
      id: 'event_list_relationship_contacts',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_CONTACTS',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION'
    },
    {
      id: 'event_view_relationship_contacts',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_CONTACTS',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION'
    },
    {
      id: 'event_create_relationship_contacts',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_CONTACTS',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION'
    },
    {
      id: 'event_modify_relationship_contacts',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_CONTACTS',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION'
    },
    {
      id: 'event_delete_relationship_contacts',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_CONTACTS',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION'
    },
    {
      id: 'event_list_relationship_exposures',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_EXPOSURES',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION'
    },
    {
      id: 'event_view_relationship_exposures',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_EXPOSURES',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION'
    },
    {
      id: 'event_create_relationship_exposures',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_EXPOSURES',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION'
    },
    {
      id: 'event_modify_relationship_exposures',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_EXPOSURES',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION'
    },
    {
      id: 'event_delete_relationship_exposures',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_EXPOSURES',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION'
    },
    {
      id: 'event_reverse_relationship',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_EVENT_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_EVENT_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'event_without_relationships',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EVENT_WITHOUT_RELATIONSHIPS',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EVENT_WITHOUT_RELATIONSHIPS_DESCRIPTION'
    },
    {
      id: 'event_export_relationships',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_EVENT_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_EVENT_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'event_share_relationships',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_EVENT_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_EVENT_RELATIONSHIP_DESCRIPTION'
    },

    // Relationship
    {
      id: 'relationship_view',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_list',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_create',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_modify',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_delete',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_reverse',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_export',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_RELATIONSHIP_DESCRIPTION'
    },
    {
      id: 'relationship_share',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_RELATIONSHIP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_RELATIONSHIP_DESCRIPTION'
    },



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
    },
    {
      id: 'write_help',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_HELP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_HELP_DESCRIPTION'
    },
    {
      id: 'approve_help',
      label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_APPROVE_HELP',
      description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_APPROVE_HELP_DESCRIPTION'
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
