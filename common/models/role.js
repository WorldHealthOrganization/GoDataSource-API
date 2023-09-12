'use strict';

const _ = require('lodash');
const app = require('../../server/server');

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
            Role.availablePermissions.forEach(function (group) {
              (group.permissions || []).forEach(function (permission) {
                if (instance.permissionIds.indexOf(permission.id) !== -1) {
                  permissions.push(permission);
                }
              });
            });
          }
          resolve(permissions);
        });
      }
    }
  };

  Role.availablePermissions = [
    // System settings
    {
      groupAllId: 'system_settings_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_SYSTEM_SETTINGS',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_SYSTEM_SETTINGS_DESCRIPTION',
      permissions: [
        {
          id: 'system_settings_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_SYSTEM_SETTINGS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_SYSTEM_SETTINGS_DESCRIPTION',
          requires: []
        },
        {
          id: 'system_settings_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_SYSTEM_SETTINGS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_SYSTEM_SETTINGS_DESCRIPTION',
          requires: [
            'system_settings_view'
          ]
        },
        {
          id: 'system_settings_modify_saved_filters',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_SYSTEM_SETTINGS_SAVED_FILTERS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_SYSTEM_SETTINGS_SAVED_FILTERS_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'system_settings_delete_saved_filters',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_SYSTEM_SETTINGS_SAVED_FILTERS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_SYSTEM_SETTINGS_SAVED_FILTERS_DESCRIPTION',
          requires: [
            'system_settings_modify_saved_filters'
          ]
        },
        {
          id: 'system_settings_modify_saved_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_SYSTEM_SETTINGS_SAVED_IMPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_SYSTEM_SETTINGS_SAVED_IMPORT_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'system_settings_delete_saved_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_SYSTEM_SETTINGS_SAVED_IMPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_SYSTEM_SETTINGS_SAVED_IMPORT_DESCRIPTION',
          requires: [
            'system_settings_modify_saved_import'
          ]
        }
      ]
    },

    // Audit Logs
    {
      groupAllId: 'audit_log_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_AUDIT_LOG',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_AUDIT_LOG_DESCRIPTION',
      permissions: [
        {
          id: 'audit_log_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_AUDIT_LOG',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_AUDIT_LOG_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'audit_log_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_AUDIT_LOG',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_AUDIT_LOG_DESCRIPTION',
          requires: []
        },
      ]
    },

    // Language
    {
      groupAllId: 'language_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_LANGUAGE',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_LANGUAGE_DESCRIPTION',
      permissions: [
        {
          id: 'language_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_LANGUAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_LANGUAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'language_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LANGUAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LANGUAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'language_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_LANGUAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_LANGUAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'language_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_LANGUAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_LANGUAGE_DESCRIPTION',
          requires: [
            'language_view'
          ]
        },
        {
          id: 'language_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_LANGUAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_LANGUAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'language_export_tokens',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_LANGUAGE_TOKENS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_LANGUAGE_TOKENS_DESCRIPTION',
          requires: []
        },
        {
          id: 'language_import_tokens',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_LANGUAGE_TOKENS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_LANGUAGE_TOKENS_DESCRIPTION',
          requires: []
        }
      ]
    },

    // Help
    {
      groupAllId: 'help_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_HELP',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_HELP_DESCRIPTION',
      permissions: [
        {
          id: 'help_view_category',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_HELP_CATEGORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_HELP_CATEGORY_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_list_category',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_HELP_CATEGORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_HELP_CATEGORY_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_create_category',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_HELP_CATEGORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_HELP_CATEGORY_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_modify_category',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_HELP_CATEGORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_HELP_CATEGORY_DESCRIPTION',
          requires: [
            'help_view_category'
          ]
        },
        {
          id: 'help_delete_category',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_HELP_CATEGORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_HELP_CATEGORY_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_view_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_HELP_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_HELP_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_list_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_HELP_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_HELP_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_create_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_HELP_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_HELP_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_modify_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_HELP_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_HELP_CATEGORY_ITEM_DESCRIPTION',
          requires: [
            'help_view_category_item'
          ]
        },
        {
          id: 'help_delete_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_HELP_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_HELP_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'help_approve_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_APPROVE_HELP_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_APPROVE_HELP_CATEGORY_ITEM_DESCRIPTION',
          requires: [
            'help_view_category_item',
            'help_modify_category_item'
          ]
        }
      ]
    },

    // Reference Data
    {
      groupAllId: 'reference_data_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_REFERENCE_DATA',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_REFERENCE_DATA_DESCRIPTION',
      permissions: [
        {
          id: 'reference_data_list_category',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_REFERENCE_DATA_CATEGORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_REFERENCE_DATA_CATEGORY_DESCRIPTION',
          requires: []
        },
        {
          id: 'reference_data_view_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'reference_data_list_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'reference_data_create_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'reference_data_modify_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: [
            'reference_data_view_category_item'
          ]
        },
        {
          id: 'reference_data_delete_category_item',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'reference_data_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        },
        {
          id: 'reference_data_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_REFERENCE_DATA_CATEGORY_ITEM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_REFERENCE_DATA_CATEGORY_ITEM_DESCRIPTION',
          requires: []
        }
      ]
    },

    // Icon ( e.g used by reference data )
    {
      groupAllId: 'icon_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_ICON',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_ICON_DESCRIPTION',
      permissions: [
        {
          id: 'icon_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_ICON',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_ICON_DESCRIPTION',
          requires: []
        },
        {
          id: 'icon_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_ICON',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_ICON_DESCRIPTION',
          requires: [
            'icon_list'
          ]
        },
        {
          id: 'icon_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_ICON',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_ICON_DESCRIPTION',
          requires: []
        }
      ]
    },

    // User
    {
      groupAllId: 'user_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_USER',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_USER_DESCRIPTION',
      permissions: [
        {
          id: 'user_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_USER_DESCRIPTION',
          requires: [
            'user_view'
          ]
        },
        {
          id: 'user_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_modify_own_account',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_USER_OWN_ACCOUNT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_USER_OWN_ACCOUNT_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_list_for_filters',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_FOR_FILTERS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_FOR_FILTERS_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_USER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_list_workload',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_WORKLOAD',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_WORKLOAD_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list'
          ]
        }
      ]
    },

    // User Role
    {
      groupAllId: 'user_role_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_USER_ROLE',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_USER_ROLE_DESCRIPTION',
      permissions: [
        {
          id: 'user_role_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_USER_ROLE_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'user_role_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_USER_ROLE_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'user_role_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_USER_ROLE_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_role_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_USER_ROLE_DESCRIPTION',
          requires: [
            'user_role_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'user_role_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_USER_ROLE_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_role_create_clone',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_USER_ROLE_CLONE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_USER_ROLE_CLONE_DESCRIPTION',
          requires: [
            'user_role_view',
            'user_role_create'
          ]
        },
        {
          id: 'user_role_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_USER_ROLE_DESCRIPTION',
          requires: []
        },
        {
          id: 'user_role_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_USER_ROLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_USER_ROLE_DESCRIPTION',
          requires: []
        }
      ]
    },

    // Backup
    {
      groupAllId: 'backup_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_BACKUP',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_BACKUP_DESCRIPTION',
      permissions: [
        {
          id: 'backup_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_BACKUP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_BACKUP_DESCRIPTION',
          requires: []
        },
        {
          id: 'backup_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_BACKUP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_BACKUP_DESCRIPTION',
          requires: [
            'user_list_for_filters',
            'system_settings_view'
          ]
        },
        {
          id: 'backup_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BACKUP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BACKUP_DESCRIPTION',
          requires: []
        },
        {
          id: 'backup_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_BACKUP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_BACKUP_DESCRIPTION',
          requires: []
        },
        {
          id: 'backup_automatic_settings',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BACKUP_AUTOMATIC_SETTINGS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BACKUP_AUTOMATIC_SETTINGS_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'backup_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_BACKUP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_BACKUP_DESCRIPTION',
          requires: []
        },
        {
          id: 'backup_view_cloud_location',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_BACKUP_CLOUD_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_BACKUP_CLOUD_LOCATION_DESCRIPTION',
          requires: []
        }
      ]
    },

    // Sync ( and sync log )
    {
      groupAllId: 'sync_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_SYNC',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_SYNC_DESCRIPTION',
      permissions: [
        {
          id: 'sync_log_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_SYNC_LOG',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_SYNC_LOG_DESCRIPTION',
          requires: []
        },
        {
          id: 'sync_log_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_SYNC_LOG',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_SYNC_LOG_DESCRIPTION',
          requires: [
            'system_settings_view'
          ]
        },
        {
          id: 'sync_log_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_SYNC_LOG',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_SYNC_LOG_DESCRIPTION',
          requires: []
        },
        {
          id: 'sync_log_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_SYNC_LOG',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_SYNC_LOG_DESCRIPTION',
          requires: []
        },
        {
          id: 'sync_export_package',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_SYNC_PACKAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_SYNC_PACKAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'sync_import_package',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_SYNC_PACKAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_SYNC_PACKAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'sync_settings',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SYNC_SETTINGS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SYNC_SETTINGS_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'sync_synchronize',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SYNC_SYNCHRONIZE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SYNC_SYNCHRONIZE_DESCRIPTION',
          requires: []
        }
      ]
    },

    // Upstream Server
    {
      groupAllId: 'upstream_server_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_UPSTREAM_SERVER',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_UPSTREAM_SERVER_DESCRIPTION',
      permissions: [
        {
          id: 'upstream_server_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_UPSTREAM_SERVER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_UPSTREAM_SERVER_DESCRIPTION',
          requires: [
            'system_settings_view'
          ]
        },
        {
          id: 'upstream_server_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_UPSTREAM_SERVER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_UPSTREAM_SERVER_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'upstream_server_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_UPSTREAM_SERVER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_UPSTREAM_SERVER_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'upstream_server_sync',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SYNC_UPSTREAM_SERVER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SYNC_UPSTREAM_SERVER_DESCRIPTION',
          requires: [
            'sync_log_view',
            'sync_synchronize'
          ]
        },
        {
          id: 'upstream_server_enable_sync',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_ENABLE_UPSTREAM_SERVER_SYNC',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_ENABLE_UPSTREAM_SERVER_SYNC_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'upstream_server_disable_sync',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DISABLE_UPSTREAM_SERVER_SYNC',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DISABLE_UPSTREAM_SERVER_SYNC_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        }
      ]
    },

    // Client application
    {
      groupAllId: 'client_application_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CLIENT_APPLICATION',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CLIENT_APPLICATION_DESCRIPTION',
      permissions: [
        {
          id: 'client_application_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLIENT_APPLICATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLIENT_APPLICATION_DESCRIPTION',
          requires: [
            'system_settings_view'
          ]
        },
        {
          id: 'client_application_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CLIENT_APPLICATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CLIENT_APPLICATION_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'client_application_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CLIENT_APPLICATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CLIENT_APPLICATION_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'client_application_download_conf_file',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CLIENT_APPLICATION_DOWNLOAD_CONF_FILE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CLIENT_APPLICATION_DOWNLOAD_CONF_FILE_DESCRIPTION',
          requires: []
        },
        {
          id: 'client_application_enable',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_ENABLE_CLIENT_APPLICATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_ENABLE_CLIENT_APPLICATION_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        },
        {
          id: 'client_application_disable',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DISABLE_CLIENT_APPLICATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DISABLE_CLIENT_APPLICATION_DESCRIPTION',
          requires: [
            'system_settings_view',
            'system_settings_modify'
          ]
        }
      ]
    },

    // Location
    {
      groupAllId: 'location_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_LOCATION',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_LOCATION_DESCRIPTION',
      permissions: [
        {
          id: 'location_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_LOCATION_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LOCATION_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'location_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_LOCATION_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_LOCATION_DESCRIPTION',
          requires: [
            'location_view'
          ]
        },
        {
          id: 'location_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_LOCATION_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_LOCATION_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_LOCATION_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_usage',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SEE_LOCATION_USAGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SEE_LOCATION_USAGE_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_propagate_geo_to_persons',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_PROPAGATE_LOCATION_GEO_TO_PERSONS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_PROPAGATE_LOCATION_GEO_TO_PERSONS_DESCRIPTION',
          requires: [
            'location_modify',
            'location_usage'
          ]
        }
      ]
    },

    // Device
    {
      groupAllId: 'device_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_DEVICE',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_DEVICE_DESCRIPTION',
      permissions: [
        {
          id: 'device_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DEVICE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DEVICE_DESCRIPTION',
          requires: []
        },
        {
          id: 'device_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_DEVICE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_DEVICE_DESCRIPTION',
          requires: []
        },
        {
          id: 'device_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_DEVICE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_DEVICE_DESCRIPTION',
          requires: [
            'device_view'
          ]
        },
        {
          id: 'device_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_DEVICE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_DEVICE_DESCRIPTION',
          requires: []
        },
        {
          id: 'device_list_history',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_DEVICE_HISTORY',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_DEVICE_HISTORY_DESCRIPTION',
          requires: []
        },
        {
          id: 'device_wipe',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WIPE_DEVICE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WIPE_DEVICE_DESCRIPTION',
          requires: []
        }
      ]
    },

    // Outbreak
    {
      groupAllId: 'outbreak_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_OUTBREAK',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_OUTBREAK_DESCRIPTION',
      permissions: [
        {
          id: 'outbreak_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_OUTBREAK_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'outbreak_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_OUTBREAK_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'outbreak_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'outbreak_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_OUTBREAK_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_OUTBREAK_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_make_active',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MAKE_OUTBREAK_ACTIVE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MAKE_OUTBREAK_ACTIVE_DESCRIPTION',
          requires: [
            'user_modify_own_account'
          ]
        },
        {
          id: 'outbreak_see_inconsistencies',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SEE_OUTBREAK_INCONSISTENCIES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SEE_OUTBREAK_INCONSISTENCIES_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_modify_case_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CASE_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CASE_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'outbreak_modify'
          ]
        },
        {
          id: 'outbreak_modify_contact_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CONTACT_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CONTACT_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'outbreak_modify'
          ]
        },
        {
          id: 'outbreak_modify_event_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_EVENT_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_EVENT_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'outbreak_modify'
          ]
        },
        {
          id: 'outbreak_modify_contact_follow_up_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CONTACT_FOLLOW_UP_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CONTACT_FOLLOW_UP_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'outbreak_modify'
          ]
        },
        {
          id: 'outbreak_modify_case_lab_result_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CASE_LAB_RESULT_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CASE_LAB_RESULT_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'outbreak_modify'
          ]
        },
        {
          id: 'outbreak_create_clone',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_CLONE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_CLONE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'outbreak_create'
          ]
        }
      ]
    },

    // Outbreak Template
    {
      groupAllId: 'outbreak_template_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_OUTBREAK_TEMPLATE',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_OUTBREAK_TEMPLATE_DESCRIPTION',
      permissions: [
        {
          id: 'outbreak_template_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_OUTBREAK_TEMPLATE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_OUTBREAK_TEMPLATE_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_template_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_OUTBREAK_TEMPLATE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_OUTBREAK_TEMPLATE_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_template_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_TEMPLATE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_TEMPLATE_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_template_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_DESCRIPTION',
          requires: [
            'outbreak_template_view'
          ]
        },
        {
          id: 'outbreak_template_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_OUTBREAK_TEMPLATE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_OUTBREAK_TEMPLATE_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_template_modify_case_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CASE_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CASE_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_template_modify'
          ]
        },
        {
          id: 'outbreak_template_modify_contact_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CONTACT_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CONTACT_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_template_modify'
          ]
        },
        {
          id: 'outbreak_template_modify_event_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_EVENT_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_EVENT_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_template_modify'
          ]
        },
        {
          id: 'outbreak_template_modify_contact_follow_up_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CONTACT_FOLLOW_UP_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_CONTACT_TEMPLATE_FOLLOW_UP_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_template_modify'
          ]
        },
        {
          id: 'outbreak_template_modify_case_lab_result_questionnaire',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CASE_LAB_RESULT_QUESTIONNAIRE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_TEMPLATE_CASE_LAB_RESULT_QUESTIONNAIRE_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_template_modify'
          ]
        },
        {
          id: 'outbreak_template_generate_outbreak',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_OUTBREAK_TEMPLATE_GENERATE_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_OUTBREAK_TEMPLATE_GENERATE_OUTBREAK_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_create'
          ]
        },
        {
          id: 'outbreak_template_create_clone',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_TEMPLATE_CLONE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_TEMPLATE_CLONE_DESCRIPTION',
          requires: [
            'outbreak_template_view',
            'outbreak_template_create'
          ]
        }
      ]
    },

    // Team
    {
      groupAllId: 'team_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_TEAM',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_TEAM_DESCRIPTION',
      permissions: [
        {
          id: 'team_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_TEAM_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'team_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_TEAM_DESCRIPTION',
          requires: []
        },
        {
          id: 'team_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_TEAM_DESCRIPTION',
          requires: [
            'user_list_for_filters'
          ]
        },
        {
          id: 'team_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_TEAM_DESCRIPTION',
          requires: [
            'team_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'team_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_TEAM_DESCRIPTION',
          requires: [
            'outbreak_view',
            'follow_up_list'
          ]
        },
        {
          id: 'team_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_TEAM_DESCRIPTION',
          requires: []
        },
        {
          id: 'team_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_TEAM_DESCRIPTION',
          requires: []
        },
        {
          id: 'team_list_workload',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_TEAM_WORKLOAD',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_TEAM_WORKLOAD_DESCRIPTION',
          requires: [
            'outbreak_view',
            'team_list'
          ]
        }
      ]
    },

    // Cluster
    {
      groupAllId: 'cluster_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CLUSTER',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CLUSTER_DESCRIPTION',
      permissions: [
        {
          id: 'cluster_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CLUSTER_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'cluster_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLUSTER_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'cluster_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CLUSTER_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'cluster_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CLUSTER_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cluster_view'
          ]
        },
        {
          id: 'cluster_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CLUSTER_DESCRIPTION',
          requires: []
        },
        {
          id: 'cluster_list_people',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLUSTER_PEOPLE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLUSTER_PEOPLE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        }
      ]
    },

    // Event
    {
      groupAllId: 'event_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_EVENT',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_EVENT_DESCRIPTION',
      permissions: [
        {
          id: 'event_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_VIEW_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'event_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'event_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_generate_visual_id'
          ]
        },
        {
          id: 'event_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_view',
            'user_list_for_filters',
            'event_generate_visual_id'
          ]
        },
        {
          id: 'event_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_list_isolated_contacts'
          ]
        },
        {
          id: 'event_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_EVENT_DESCRIPTION',
          requires: []
        },
        {
          id: 'event_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_generate_visual_id'
          ]
        },
        {
          id: 'event_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_bulk_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_create_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_create',

            // used by create contact
            'event_view'
          ]
        },
        {
          id: 'event_create_bulk_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_bulk_create',

            // used by create contact
            'event_view'
          ]
        },
        {
          id: 'event_generate_visual_id',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_EVENT_VISUAL_ID',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_EVENT_VISUAL_ID_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_list_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'event_view_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'event_create_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'event_modify_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'event_delete_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'event_list_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'event_list_isolated_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_ISOLATED_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_ISOLATED_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_view_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'event_create_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'event_modify_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'event_delete_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'event_reverse_relationship',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_EVENT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_EVENT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_reverse'
          ]
        },
        {
          id: 'event_without_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EVENT_WITHOUT_RELATIONSHIPS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EVENT_WITHOUT_RELATIONSHIPS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'event_export_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_EVENT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_EVENT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_export'
          ]
        },
        {
          id: 'event_share_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_EVENT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_EVENT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_share'
          ]
        },
        {
          id: 'event_change_source_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_EVENT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_EVENT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_change_target_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_EVENT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_EVENT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ],
          hidden: true
        },
        {
          id: 'event_bulk_delete_relationships_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_EVENT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_EVENT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'event_bulk_delete_relationships_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_EVENT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_EVENT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        }
      ]
    },

    // Contact
    {
      groupAllId: 'contact_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_DESCRIPTION',
      permissions: [
        {
          id: 'contact_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'relationship_list'
          ]
        },
        {
          id: 'contact_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'contact_grouped_by_risk'
          ]
        },
        {
          id: 'contact_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_DESCRIPTION',
          requires: [
            // used to check for duplicates
            'contact_list',
            'outbreak_view',
            'contact_generate_visual_id',

            // must create case / event relationship
            'relationship_create'
          ]
        },
        {
          id: 'contact_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_DESCRIPTION',
          requires: [
            // used to check for duplicates
            'contact_list',
            'outbreak_view',
            'contact_view',
            'user_list_for_filters',
            'contact_generate_visual_id',
            'relationship_list'
          ]
        },
        {
          id: 'contact_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_list_isolated_contacts'
          ]
        },
        {
          id: 'contact_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_generate_visual_id'
          ]
        },
        {
          id: 'contact_bulk_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_CREATE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_CREATE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_list',
            'contact_generate_visual_id'
          ]
        },
        {
          id: 'contact_bulk_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_list',
            'contact_generate_visual_id'
          ]
        },
        {
          id: 'contact_generate_visual_id',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_CONTACT_VISUAL_ID',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_CONTACT_VISUAL_ID_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_bulk_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_list_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'contact_view_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'contact_create_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'contact_modify_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'contact_delete_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'contact_list_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'contact_list_isolated_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_ISOLATED',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_ISOLATED_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_view_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'contact_create_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'contact_modify_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'contact_delete_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'contact_export_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_export'
          ]
        },
        {
          id: 'contact_share_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_share'
          ]
        },
        {
          id: 'contact_change_source_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_change_target_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ],
          hidden: true
        },
        {
          id: 'contact_bulk_delete_relationships_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'contact_bulk_delete_relationships_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'contact_view_movement_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_MOVEMENT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_MOVEMENT_MAP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_view'
          ]
        },
        {
          id: 'contact_export_movement_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_MOVEMENT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_MOVEMENT_MAP_DESCRIPTION',
          requires: [
            'contact_view_movement_map'
          ]
        },
        {
          id: 'contact_view_chronology_chart',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_CHRONOLOGY_CHART',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_CHRONOLOGY_CHART_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_view',
            'relationship_list',
            'follow_up_list',
            'contact_list_lab_result'
          ]
        },
        {
          id: 'contact_convert_to_case',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CONTACT_TO_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CONTACT_TO_CASE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_convert_to_contact_of_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CONTACT_TO_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CONTACT_TO_CASE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_list_isolated_contacts'
          ]
        },
        {
          id: 'contact_export_daily_follow_up_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DAILY_FOLLOW_UP_LIST',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DAILY_FOLLOW_UP_LIST_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_export_daily_follow_up_form',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DAILY_FOLLOW_UP_FORM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DAILY_FOLLOW_UP_FORM_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_export_dossier',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DOSSIER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_DOSSIER_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_grouped_by_risk',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_BY_RISK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_BY_RISK_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_view_follow_up_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_FOLLOW_UP_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_FOLLOW_UP_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_count_from_follow_up',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_FROM_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_FROM_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_count_lost_to_follow_up',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_LOST_TO_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_LOST_TO_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_count_not_seen_in_x_days',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_NOT_SEEN_IN_X_DAYS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_NOT_SEEN_IN_X_DAYS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_count_seen',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_SEEN',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_SEEN_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_count_successful_follow_ups',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_SUCCESSFUL_FOLLOW_UPS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CONTACT_SUCCESSFUL_FOLLOW_UPS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_export_follow_up_success_rate_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_FOLLOW_UP_SUCCESS_RATE_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_FOLLOW_UP_SUCCESS_RATE_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_list_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_list',
            'contact_view'
          ]
        },
        {
          id: 'contact_view_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_view',
            'contact_view'
          ]
        },
        {
          id: 'contact_create_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_create',
            'contact_view'
          ]
        },
        {
          id: 'contact_modify_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_modify',
            'contact_view'
          ]
        },
        {
          id: 'contact_delete_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_delete'
          ]
        },
        {
          id: 'contact_restore_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_restore'
          ]
        },
        {
          id: 'contact_import_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_import'
          ]
        },
        {
          id: 'contact_export_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_export'
          ]
        },
        {
          id: 'contact_create_contact_of_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_OF_CONTACT_FROM_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_OF_CONTACT_FROM_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_create',

            // used by create contact of contact
            'contact_of_contact_view'
          ]
        },
        {
          id: 'contact_create_bulk_contact_of_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_OF_CONTACT_FROM_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_OF_CONTACT_FROM_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_bulk_create',
            'contact_view'
          ]
        },
        {
          id: 'contact_of_contact_share_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_CONTACT_OF_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_CONTACT_OF_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_share'
          ]
        }
      ]
    },

    // Case
    {
      groupAllId: 'case_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CASE',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CASE_DESCRIPTION',
      permissions: [
        {
          id: 'case_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'case_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'case_grouped_by_classification'
          ]
        },
        {
          id: 'case_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_DESCRIPTION',
          requires: [
            // used to check for duplicates
            'case_list',
            'outbreak_view',
            'case_generate_visual_id'
          ]
        },
        {
          id: 'case_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_DESCRIPTION',
          requires: [
            // used to check for duplicates
            'case_list',
            'outbreak_view',
            'case_view',
            'user_list_for_filters',
            'case_generate_visual_id'
          ]
        },
        {
          id: 'case_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list_isolated_cases'
          ]
        },
        {
          id: 'case_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CASE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_DESCRIPTION',
          requires: []
        },
        {
          id: 'case_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CASE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_create_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_CASE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_create',

            // used by create contact
            'case_view'
          ]
        },
        {
          id: 'case_create_bulk_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_CASE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_bulk_create',

            // used by create contact
            'case_view'
          ]
        },
        {
          id: 'case_generate_visual_id',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_CASE_VISUAL_ID',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_CASE_VISUAL_ID_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CASE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_bulk_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_CASE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_CASE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'case_view_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'case_create_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'case_modify_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'case_delete_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'case_list_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'case_view_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'case_create_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'case_modify_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'case_delete_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'case_reverse_relationship',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_CASE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_CASE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_reverse'
          ]
        },
        {
          id: 'case_without_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CASE_WITHOUT_RELATIONSHIPS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CASE_WITHOUT_RELATIONSHIPS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'case_export_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_export'
          ]
        },
        {
          id: 'case_share_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_CASE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_CASE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_share'
          ]
        },
        {
          id: 'case_change_source_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_CASE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_CASE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_change_target_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_CASE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_CASE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ],
          hidden: true
        },
        {
          id: 'case_bulk_delete_relationships_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CASE_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CASE_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'case_bulk_delete_relationships_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CASE_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CASE_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'case_view_movement_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_MOVEMENT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_MOVEMENT_MAP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_view'
          ]
        },
        {
          id: 'case_export_movement_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_MOVEMENT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_MOVEMENT_MAP_DESCRIPTION',
          requires: [
            'case_view_movement_map'
          ]
        },
        {
          id: 'case_view_chronology_chart',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_CHRONOLOGY_CHART',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_CHRONOLOGY_CHART_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_view',
            'relationship_list',
            'case_list_lab_result'
          ]
        },
        {
          id: 'case_convert_to_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CASE_TO_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CASE_TO_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list_isolated_cases'
          ]
        },
        {
          id: 'case_export_dossier',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_DOSSIER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_DOSSIER_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_grouped_by_classification',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CASE_BY_CLASSIFICATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CASE_BY_CLASSIFICATION_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_onset_before_primary_case_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_ONSET_BEFORE_PRIMARY_CASE_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_ONSET_BEFORE_PRIMARY_CASE_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_long_period_between_onset_dates_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_LONG_PERIOD_BETWEEN_ONSET_DATES_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_LONG_PERIOD_BETWEEN_ONSET_DATES_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_isolated_cases',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_ISOLATED',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_ISOLATED_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_export_investigation_form',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_INVESTIGATION_FORM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_INVESTIGATION_FORM_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_export_empty_investigation_forms',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_EMPTY_INVESTIGATION_FORMS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_EMPTY_INVESTIGATION_FORMS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_grouped_by_location_level',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CASE_BY_LOCATION_LEVEL',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CASE_BY_LOCATION_LEVEL_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_stratified_by_classification_over_time',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_STRATIFIED_BY_CLASSIFICATION_OVER_TIME',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_STRATIFIED_BY_CLASSIFICATION_OVER_TIME_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_stratified_by_outcome_over_time',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_STRATIFIED_BY_OUTCOME_OVER_TIME',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_STRATIFIED_BY_OUTCOME_OVER_TIME_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_stratified_by_classification_over_reporting_time',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_STRATIFIED_BY_CLASSIFICATION_OVER_REPORTING_TIME',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_STRATIFIED_BY_CLASSIFICATION_OVER_REPORTING_TIME_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_cases_by_period_and_contact_status',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_PER_PERIOD_AND_CONTACT_STATUS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_PER_PERIOD_AND_CONTACT_STATUS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_cases_with_less_than_x_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_WITH_LESS_THAN_X_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_WITH_LESS_THAN_X_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_cases_new_in_previous_x_days_detected_among_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_NEW_IN_PREVIOUS_X_DAYS_DETECTED_AMONG_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_NEW_IN_PREVIOUS_X_DAYS_DETECTED_AMONG_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_cases_new_in_known_cot',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_NEW_IN_KNOWN_COT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_NEW_IN_KNOWN_COT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_count_case_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CASE_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_COUNT_CASE_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_export_classification_per_location_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_CLASSIFICATION_PER_LOCATION_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_CLASSIFICATION_PER_LOCATION_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'case_list_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_list',
            'case_view'
          ]
        },
        {
          id: 'case_view_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_view',
            'case_view'
          ]
        },
        {
          id: 'case_create_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_create',
            'case_view'
          ]
        },
        {
          id: 'case_modify_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_modify',
            'case_view'
          ]
        },
        {
          id: 'case_delete_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_delete'
          ]
        },
        {
          id: 'case_restore_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_restore'
          ]
        },
        {
          id: 'case_import_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_import'
          ]
        },
        {
          id: 'case_export_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CASE_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_export'
          ]
        }
      ]
    },

    // Relationship
    {
      groupAllId: 'relationship_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_RELATIONSHIP',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_RELATIONSHIP_DESCRIPTION',
      permissions: [
        {
          id: 'relationship_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'relationship_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'relationship_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cluster_list'
          ]
        },
        {
          id: 'relationship_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'relationship_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_reverse',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_REVERSE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_share',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_SHARE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        }
      ]
    },

    // Follow-Up
    {
      groupAllId: 'follow_up_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_FOLLOW_UP',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_FOLLOW_UP_DESCRIPTION',
      permissions: [
        {
          id: 'follow_up_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'team_list'
          ]
        },
        {
          id: 'follow_up_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'team_list',
            'follow_up_grouped_by_team',
            'contact_view'
          ]
        },
        {
          id: 'follow_up_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_view'
          ]
        },
        {
          id: 'follow_up_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'follow_up_view',
            'user_list_for_filters',
            'team_list'
          ]
        },
        {
          id: 'follow_up_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_list_range',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_FOLLOW_UP_RANGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_FOLLOW_UP_RANGE_DESCRIPTION',
          requires: [
            'outbreak_view',
            'team_list'
          ]
        },
        {
          id: 'follow_up_generate',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'team_list'
          ]
        },
        {
          id: 'follow_up_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_export_range',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_FOLLOW_UP_RANGE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_FOLLOW_UP_RANGE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_export_daily_form',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_FOLLOW_UP_DAILY_FORM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_FOLLOW_UP_DAILY_FORM_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_bulk_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'follow_up_list',
            'follow_up_modify'
          ]
        },
        {
          id: 'follow_up_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_bulk_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_FOLLOW_UP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_FOLLOW_UP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'follow_up_grouped_by_team',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_FOLLOW_UP_BY_TEAM',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_FOLLOW_UP_BY_TEAM_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        }
      ]
    },

    // Lab result
    {
      groupAllId: 'lab_result_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_LAB_RESULT',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_LAB_RESULT_DESCRIPTION',
      permissions: [
        {
          id: 'lab_result_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'lab_result_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'lab_result_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'lab_result_view',
            'lab_result_list'
          ]
        },
        {
          id: 'lab_result_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_bulk_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'lab_result_bulk_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_LAB_RESULT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'lab_result_list',
            'lab_result_modify'
          ]
        }
      ]
    },

    // Gantt Chart
    {
      groupAllId: 'gantt_chart_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_GANTT_CHART',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_GANTT_CHART_DESCRIPTION',
      permissions: [
        {
          id: 'gantt_chart_view_delay_onset_lab_testing',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DELAY_BETWEEN_SYMPTOM_AND_LAB',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DELAY_BETWEEN_SYMPTOM_AND_LAB_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'gantt_chart_view_delay_onset_hospitalization',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DELAY_BETWEEN_ONSET_HOSPITALIZATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DELAY_BETWEEN_ONSET_HOSPITALIZATION_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'gantt_chart_export_delay_onset_lab_testing',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DELAY_BETWEEN_SYMPTOM_AND_LAB',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DELAY_BETWEEN_SYMPTOM_AND_LAB_DESCRIPTION',
          requires: [
            'gantt_chart_view_delay_onset_lab_testing'
          ]
        },
        {
          id: 'gantt_chart_export_delay_onset_hospitalization',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DELAY_BETWEEN_ONSET_HOSPITALIZATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DELAY_BETWEEN_ONSET_HOSPITALIZATION_DESCRIPTION',
          requires: [
            'gantt_chart_view_delay_onset_hospitalization'
          ]
        }
      ]
    },

    // Chains of transmission
    {
      groupAllId: 'cot_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_COT',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_COT_DESCRIPTION',
      permissions: [
        {
          id: 'cot_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_COT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_COT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'cot_export_bar_chart',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_COT_BAR_CHART',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_COT_BAR_CHART_DESCRIPTION',
          requires: []
        },
        {
          id: 'cot_export_graphs',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_COT_GRAPHS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_COT_GRAPHS_DESCRIPTION',
          requires: []
        },
        {
          id: 'cot_export_case_count_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_COT_CASE_COUNT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_COT_CASE_COUNT_MAP_DESCRIPTION',
          requires: []
        },
        {
          id: 'cot_view_bar_chart',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_BAR_CHART',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_BAR_CHART_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'cot_view_case_count_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_CASE_COUNT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_CASE_COUNT_MAP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'cot_view_geospatial_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_GEOSPATIAL_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_GEOSPATIAL_MAP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cluster_list',
            'cot_list'
          ]
        },
        {
          id: 'cot_view_bubble_network',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_BUBBLE_NETWORK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_BUBBLE_NETWORK_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_list',
            'event_view',
            'contact_list',
            'contact_view',
            'case_list',
            'case_view',
            'relationship_view',
            'cluster_list',
            'cot_list'
          ]
        },
        {
          id: 'cot_modify_bubble_network',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_BUBBLE_NETWORK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_BUBBLE_NETWORK_DESCRIPTION',
          requires: [
            'cot_view_bubble_network',
            'event_modify',
            'contact_create',
            'contact_modify',
            'case_modify',
            'relationship_modify',
            'event_view_relationship_contacts',
            'event_modify_relationship_contacts',
            'case_view_relationship_contacts',
            'case_modify_relationship_contacts'
          ]
        },
        {
          id: 'cot_view_hierarchical_network',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_HIERARCHICAL_NETWORK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_HIERARCHICAL_NETWORK_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_list',
            'event_view',
            'contact_list',
            'contact_view',
            'case_list',
            'case_view',
            'relationship_view',
            'cluster_list',
            'cot_list'
          ]
        },
        {
          id: 'cot_modify_hierarchical_network',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_HIERARCHICAL_NETWORK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_HIERARCHICAL_NETWORK_DESCRIPTION',
          requires: [
            'cot_view_hierarchical_network',
            'event_modify',
            'contact_create',
            'contact_modify',
            'case_modify',
            'relationship_modify',
            'event_view_relationship_contacts',
            'event_modify_relationship_contacts',
            'case_view_relationship_contacts',
            'case_modify_relationship_contacts'
          ]
        },
        {
          id: 'cot_view_timeline_network_date_of_onset',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_TIMELINE_NETWORK_DATE_OF_ONSET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_TIMELINE_NETWORK_DATE_OF_ONSET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_list',
            'event_view',
            'contact_list',
            'contact_view',
            'case_list',
            'case_view',
            'relationship_view',
            'cluster_list',
            'cot_list'
          ]
        },
        {
          id: 'cot_modify_timeline_network_date_of_onset',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_TIMELINE_NETWORK_DATE_OF_ONSET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_TIMELINE_NETWORK_DATE_OF_ONSET_DESCRIPTION',
          requires: [
            'cot_view_timeline_network_date_of_onset',
            'event_modify',
            'contact_create',
            'contact_modify',
            'case_modify',
            'relationship_modify',
            'event_view_relationship_contacts',
            'event_modify_relationship_contacts',
            'case_view_relationship_contacts',
            'case_modify_relationship_contacts'
          ]
        },
        {
          id: 'cot_view_timeline_network_date_of_last_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_TIMELINE_NETWORK_DATE_OF_LAST_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_TIMELINE_NETWORK_DATE_OF_LAST_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_list',
            'event_view',
            'contact_list',
            'contact_view',
            'case_list',
            'case_view',
            'relationship_view',
            'cluster_list',
            'cot_list'
          ]
        },
        {
          id: 'cot_modify_timeline_network_date_of_last_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_TIMELINE_NETWORK_DATE_OF_LAST_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_TIMELINE_NETWORK_DATE_OF_LAST_CONTACT_DESCRIPTION',
          requires: [
            'cot_view_timeline_network_date_of_last_contact',
            'event_modify',
            'contact_create',
            'contact_modify',
            'case_modify',
            'relationship_modify',
            'event_view_relationship_contacts',
            'event_modify_relationship_contacts',
            'case_view_relationship_contacts',
            'case_modify_relationship_contacts'
          ]
        },
        {
          id: 'cot_view_timeline_network_date_of_reporting',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_TIMELINE_NETWORK_DATE_OF_REPORTING',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_COT_TIMELINE_NETWORK_DATE_OF_REPORTING_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_list',
            'event_view',
            'contact_list',
            'contact_view',
            'case_list',
            'case_view',
            'relationship_view',
            'cluster_list',
            'cot_list'
          ]
        },
        {
          id: 'cot_modify_timeline_network_date_of_reporting',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_TIMELINE_NETWORK_DATE_OF_REPORTING',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_COT_TIMELINE_NETWORK_DATE_OF_REPORTING_DESCRIPTION',
          requires: [
            'cot_view_timeline_network_date_of_reporting',
            'event_modify',
            'contact_create',
            'contact_modify',
            'case_modify',
            'relationship_modify',
            'event_view_relationship_contacts',
            'event_modify_relationship_contacts',
            'case_view_relationship_contacts',
            'case_modify_relationship_contacts'
          ]
        },
        {
          id: 'cot_list_new_from_contacts_became_cases',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_COT_NEW_FROM_CONTACTS_BECAME_CASES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_COT_NEW_FROM_CONTACTS_BECAME_CASES_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        }
      ]
    },

    // Duplicate
    {
      groupAllId: 'duplicate_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_DUPLICATE',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_DUPLICATE_DESCRIPTION',
      permissions: [
        {
          id: 'duplicate_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_DUPLICATE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_DUPLICATE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'duplicate_merge_cases',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_CASES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_CASES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'duplicate_list'
          ]
        },
        {
          id: 'duplicate_merge_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'duplicate_list'
          ]
        },
        {
          id: 'duplicate_merge_events',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_EVENTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_EVENTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'duplicate_list'
          ]
        },
        {
          id: 'duplicate_merge_contacts_of_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_CONTACTS_OF_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MERGE_DUPLICATE_CONTACTS_OF_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'duplicate_list'
          ]
        }
      ]
    },

    // Dashboard
    {
      groupAllId: 'dashboard_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_DASHBOARD',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_DASHBOARD_DESCRIPTION',
      permissions: [
        {
          id: 'dashboard_view_case_summary_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_SUMMARY_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_SUMMARY_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_grouped_by_classification'
          ]
        },
        {
          id: 'dashboard_view_case_per_location_level_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_PER_LOCATION_LEVEL_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_PER_LOCATION_LEVEL_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_grouped_by_location_level'
          ]
        },
        {
          id: 'dashboard_view_case_hospitalized_pie_chart_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_HOSPITALIZED_PIE_CHART_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_HOSPITALIZED_PIE_CHART_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_cot_size_histogram_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_COT_SIZE_HISTOGRAM_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_COT_SIZE_HISTOGRAM_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cot_list'
          ]
        },
        {
          id: 'dashboard_view_epi_curve_classification_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_EPI_CURVE_CLASSIFICATION_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_EPI_CURVE_CLASSIFICATION_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_stratified_by_classification_over_time'
          ]
        },
        {
          id: 'dashboard_view_epi_curve_outcome_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_EPI_CURVE_OUTCOME_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_EPI_CURVE_OUTCOME_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_stratified_by_outcome_over_time'
          ]
        },
        {
          id: 'dashboard_view_epi_curve_reporting_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_EPI_CURVE_REPORTING_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_EPI_CURVE_REPORTING_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_stratified_by_classification_over_reporting_time'
          ]
        },
        {
          id: 'dashboard_view_contact_follow_up_report_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_FOLLOW_UP_REPORT_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_FOLLOW_UP_REPORT_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_view_follow_up_report'
          ]
        },
        {
          id: 'dashboard_view_contact_status_report_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_STATUS_REPORT_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_STATUS_REPORT_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list_cases_by_period_and_contact_status'
          ]
        },
        {
          id: 'dashboard_view_case_deceased_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_DECEASED_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_DECEASED_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_case_hospitalized_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_HOSPITALIZED_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_HOSPITALIZED_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_case_with_less_than_x_contacts_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_WITH_LESS_THAN_X_CONTACTS_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_WITH_LESS_THAN_X_CONTACTS_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list_cases_with_less_than_x_contacts'
          ]
        },
        {
          id: 'dashboard_view_case_new_in_previous_x_days_detected_among_contacts_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_NEW_IN_PREV_DAYS_AMONG_KNOWN_CONTACTS_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_NEW_IN_PREV_DAYS_AMONG_KNOWN_CONTACTS_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list_cases_new_in_previous_x_days_detected_among_contacts'
          ]
        },
        {
          id: 'dashboard_view_case_refusing_treatment_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_REFUSING_TREATMENT_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_REFUSING_TREATMENT_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_case_new_known_cot_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_NEW_IN_COT_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_NEW_IN_COT_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list_cases_new_in_known_cot'
          ]
        },
        {
          id: 'dashboard_view_case_with_pending_lab_results_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_WITH_PENDING_LAB_RESULTS_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_WITH_PENDING_LAB_RESULTS_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_case_not_identified_through_contacts_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_NOT_IDENTIFIED_THROUGH_CONTACTS_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CASE_NOT_IDENTIFIED_THROUGH_CONTACTS_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_contacts_per_case_mean_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACTS_PER_CASE_MEAN_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACTS_PER_CASE_MEAN_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_count_case_contacts'
          ]
        },
        {
          id: 'dashboard_view_contacts_per_case_median_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACTS_PER_CASE_MEDIAN_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACTS_PER_CASE_MEDIAN_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_count_case_contacts'
          ]
        },
        {
          id: 'dashboard_view_contact_from_follow_up_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_FROM_FOLLOW_UP_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_FROM_FOLLOW_UP_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_count_from_follow_up'
          ]
        },
        {
          id: 'dashboard_view_contact_lost_to_follow_up_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_LOST_TO_FOLLOW_UP_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_LOST_TO_FOLLOW_UP_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_count_lost_to_follow_up'
          ]
        },
        {
          id: 'dashboard_view_contact_not_seen_in_x_days_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_NOT_SEEN_IN_X_DAYS_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_NOT_SEEN_IN_X_DAYS_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_count_not_seen_in_x_days'
          ]
        },
        {
          id: 'dashboard_view_contact_become_case_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_BECOME_CASE_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_BECOME_CASE_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_list'
          ]
        },
        {
          id: 'dashboard_view_contact_seen_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_SEEN_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_SEEN_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_count_seen'
          ]
        },
        {
          id: 'dashboard_view_contact_successful_follow_ups_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_SUCCESSFUL_FOLLOW_UPS_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_CONTACT_SUCCESSFUL_FOLLOW_UPS_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_count_successful_follow_ups'
          ]
        },
        {
          id: 'dashboard_view_independent_cot_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_INDEPENDENT_COT_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_INDEPENDENT_COT_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cot_list'
          ]
        },
        {
          id: 'dashboard_view_active_cot_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_ACTIVE_COT_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_ACTIVE_COT_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cot_list'
          ]
        },
        {
          id: 'dashboard_view_new_chains_from_contacts_became_cases_dashlet',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_NEW_CHAINS_FROM_CONTACTS_WHO_BECAME_CASES_DASHLET',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_DASHBOARD_NEW_CHAINS_FROM_CONTACTS_WHO_BECAME_CASES_DASHLET_DESCRIPTION',
          requires: [
            'outbreak_view',
            'cot_list_new_from_contacts_became_cases'
          ]
        },
        {
          id: 'dashboard_export_case_classification_per_location_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_CASE_CLASSIFICATION_PER_LOCATION_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_CASE_CLASSIFICATION_PER_LOCATION_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'case_export_classification_per_location_report'
          ]
        },
        {
          id: 'dashboard_export_contact_follow_up_success_rate_report',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_CONTACT_FOLLOW_UP_SUCCESS_RATE_REPORT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_CONTACT_FOLLOW_UP_SUCCESS_RATE_REPORT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_export_follow_up_success_rate_report'
          ]
        },
        {
          id: 'dashboard_export_epi_curve',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_EPI_CURVE',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_EPI_CURVE_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'dashboard_export_kpi',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_KPI',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_DASHBOARD_KPI_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        }
      ]
    },

    // Contact Of Contact
    {
      groupAllId: 'contact_of_contact_all',
      groupLabel: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_OF_CONTACT',
      groupDescription: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_OF_CONTACT_DESCRIPTION',
      permissions: [
        {
          id: 'contact_of_contact_view',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters'
          ]
        },
        {
          id: 'contact_of_contact_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'user_list_for_filters',
            'contact_of_contact_grouped_by_risk'
          ]
        },
        {
          id: 'contact_of_contact_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            // used to check for duplicates
            'contact_of_contact_list',
            'outbreak_view',
            'contact_of_contact_generate_visual_id',

            // must create contact relationship
            'relationship_create'
          ]
        },
        {
          id: 'contact_of_contact_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            // used to check for duplicates
            'contact_of_contact_list',
            'outbreak_view',
            'contact_of_contact_view',
            'user_list_for_filters',
            'contact_of_contact_generate_visual_id',
            'relationship_list'
          ]
        },
        {
          id: 'contact_of_contact_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_export',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_import',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_IMPORT_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_generate_visual_id'
          ]
        },
        {
          id: 'contact_of_contact_bulk_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_MODIFY_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_list',
            'contact_of_contact_generate_visual_id'
          ]
        },
        {
          id: 'contact_of_contact_generate_visual_id',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_CONTACT_OF_CONTACT_VISUAL_ID',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GENERATE_CONTACT_OF_CONTACT_VISUAL_ID_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_bulk_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_bulk_restore',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_RESTORE_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_list_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'contact_of_contact_view_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'contact_of_contact_modify_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'contact_of_contact_delete_relationship_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'contact_of_contact_list_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_list'
          ]
        },
        {
          id: 'contact_of_contact_view_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
          ]
        },
        {
          id: 'contact_of_contact_create_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_create'
          ]
        },
        {
          id: 'contact_of_contact_modify_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_modify'
          ]
        },
        {
          id: 'contact_of_contact_delete_relationship_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_delete'
          ]
        },
        {
          id: 'contact_of_contact_export_dossier',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_DOSSIER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_DOSSIER_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_view_movement_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_MOVEMENT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_MOVEMENT_MAP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_view'
          ]
        },
        {
          id: 'contact_of_contact_export_movement_map',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_MOVEMENT_MAP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_MOVEMENT_MAP_DESCRIPTION',
          requires: [
            'contact_of_contact_view_movement_map'
          ]
        },
        {
          id: 'contact_of_contact_view_chronology_chart',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_CHRONOLOGY_CHART',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_CHRONOLOGY_CHART_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_view',
            'relationship_list'
          ]
        },
        {
          id: 'contact_of_contact_grouped_by_risk',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_OF_CONTACT_BY_RISK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_GROUP_CONTACT_OF_CONTACT_BY_RISK_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_change_source_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_CONTACT_OF_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_SOURCE_CONTACT_OF_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_change_target_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_CONTACT_OF_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CHANGE_TARGET_CONTACT_OF_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ],
          hidden: true
        },
        {
          id: 'contact_of_contact_bulk_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_CREATE_CONTACT_OF_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_CREATE_CONTACT_OF_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_of_contact_list',
            'contact_of_contact_generate_visual_id'
          ]
        },
        {
          id: 'contact_of_contact_export_relationships',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_export'
          ]
        },
        {
          id: 'contact_of_contact_bulk_delete_relationships_contacts',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_CONTACTS_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'contact_of_contact_bulk_delete_relationships_exposures',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_DELETE_CONTACT_OF_CONTACT_RELATIONSHIP_EXPOSURES_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_bulk_delete'
          ]
        },
        {
          id: 'contact_of_contact_convert_to_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CONTACT_OF_CONTACT_TO_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CONVERT_CONTACT_OF_CONTACT_TO_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_of_contact_list_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_OF_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_list',
            'contact_of_contact_view'
          ]
        },
        {
          id: 'contact_of_contact_view_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_VIEW_CONTACT_OF_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_view',
            'contact_of_contact_view'
          ]
        },
        {
          id: 'contact_of_contact_modify_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_OF_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_modify',
            'contact_of_contact_view'
          ]
        },
        {
          id: 'contact_of_contact_delete_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_OF_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_delete'
          ]
        },
        {
          id: 'contact_of_contact_restore_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_OF_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_RESTORE_CONTACT_OF_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_restore'
          ]
        },
        {
          id: 'contact_of_contact_export_lab_result',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_LAB_RESULT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_EXPORT_CONTACT_OF_CONTACT_LAB_RESULT_DESCRIPTION',
          requires: [
            'lab_result_export'
          ]
        }
      ]
    },
  ];

  // map all permission to easily determine group
  Role.permissionGroupMap = _.transform(
    Role.availablePermissions,
    (acc, value) => {
      (value.permissions || []).forEach((permission) => {
        acc[permission.id] = {
          groupAllId: value.groupAllId,
          permission: permission
        };
      });
    },
    {}
  );

  Role.availablePermissionsKeys = _.transform(
    Role.availablePermissions,
    (acc, value) => {
      acc.push(...value.permissions.map(v => v.id));
    },
    []
  );

  Role.availableFullPermissionsKeys = _.map(
    Role.availablePermissions,
    (value) => value.groupAllId
  );

  Role.availableHiddenPermissionsKeys = [
    'view_system_version'
  ];

  Role.allAllowedPermissions = [
    ...Role.availablePermissionsKeys,
    ...Role.availableFullPermissionsKeys,
    ...Role.availableHiddenPermissionsKeys
  ];

  /**
   * Check the list of assigned permissionIds, make sure they are all valid
   */
  Role.validate('permissionIds', function available(error) {
    if (
      this.permissionIds &&
      Array.isArray(this.permissionIds)
    ) {
      const disallowedPermissions = [];
      this.permissionIds.forEach(function (permission) {
        if (Role.allAllowedPermissions.indexOf(permission) === -1) {
          disallowedPermissions.push(permission);
        }
      });

      if (disallowedPermissions.length) {
        error();
      }
    }
  }, {message: `at least one permission is invalid. Available permissions: "${Role.allAllowedPermissions.join('", "')}"`});

  /**
   * Retrieve roles using mongo aggregation directly
   * @param filter
   * @param countOnly Boolean
   */
  Role.findAggregate = (
    filter,
    countOnly
  ) => {
    // do we need to retrieved users that use these roles ?
    filter = filter || {};
    filter.where = filter.where || {
      includeUsers: false
    };
    let includeUsers = false;
    if (filter.where.includeUsers !== undefined) {
      includeUsers = !!filter.where.includeUsers;
      delete filter.where.includeUsers;
    }

    // execute query
    return Role
      .rawFindAggregate(
        filter, {
          countOnly: countOnly,
          matchAfterLookup: includeUsers,
          relations: includeUsers ? [{
            lookup: {
              from: 'user',
              localField: '_id',
              foreignField: 'roleIds',
              as: 'users'
            }
          }] : []
        }
      ).then((roles) => {
        // nothing to do if we just want to count follow-ups
        if (countOnly) {
          return roles;
        }

        // format & remove restricted fields
        if (includeUsers) {
          (roles || []).forEach((role) => {
            // users
            if (role.users) {
              role.users.forEach((user) => {
                // id
                user.id = user._id;
                delete user._id;

                // remove restricted fields
                app.models.user.sanitize(user);
              });
            }
          });
        }

        // finished
        return roles;
      });
  };

  // default export order
  Role.exportFieldsOrder = [
    'id'
  ];

  Role.arrayProps = {
    permissionIds: 'LNG_USER_ROLE_FIELD_LABEL_PERMISSIONS'
  };

  Role.fieldLabelsMap = Object.assign({}, Role.fieldLabelsMap, {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdOn: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_ON',
    createdAt: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT',
    name: 'LNG_USER_ROLE_FIELD_LABEL_NAME',
    permissionIds: 'LNG_USER_ROLE_FIELD_LABEL_PERMISSIONS',
    description: 'LNG_USER_ROLE_FIELD_LABEL_DESCRIPTION'
  });
};
