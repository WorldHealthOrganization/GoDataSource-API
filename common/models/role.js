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
          requires: []
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

        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // - must delete TOKENS tooo
        {
          id: 'read_user_account',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT_DESCRIPTION'
        },
        {
          id: 'write_user_account',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT_DESCRIPTION'
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
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LOCATION_USER_DESCRIPTION',
          requires: []
        },
        {
          id: 'location_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LOCATION',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_LOCATION_DESCRIPTION',
          requires: []
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
          requires: []
        },
        {
          id: 'outbreak_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_OUTBREAK_DESCRIPTION',
          requires: []
        },
        {
          id: 'outbreak_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_OUTBREAK_DESCRIPTION',
          requires: [
            // list needed to check for name duplicates
            'outbreak_list'
          ]
        },
        {
          id: 'outbreak_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_OUTBREAK_DESCRIPTION',
          requires: [
            // list needed to check for name duplicates
            'outbreak_list',
            'outbreak_view'
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
            'outbreak_create',
            'outbreak_list'
          ]
        },

        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // - must delete TOKENS tooo
        {
          id: 'read_outbreak',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK_DESCRIPTION'
        },
        {
          id: 'write_outbreak',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK_DESCRIPTION'
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
            'outbreak_create',
            'outbreak_list'
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
          requires: []
        },
        {
          id: 'cluster_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CLUSTER_DESCRIPTION',
          requires: []
        },
        {
          id: 'cluster_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CLUSTER_DESCRIPTION',
          requires: []
        },
        {
          id: 'cluster_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CLUSTER',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CLUSTER_DESCRIPTION',
          requires: [
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
          requires: []
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
            'outbreak_view'
          ]
        },
        {
          id: 'event_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'event_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'event_view'
          ]
        },
        {
          id: 'event_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view'
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
          id: 'event_create_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_FROM_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_create'
          ]
        },
        {
          id: 'event_create_bulk_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_EVENT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_BULK_CONTACT_FROM_EVENT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_bulk_create'
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
            'outbreak_view'
          ]
        },
        {
          id: 'contact_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'contact_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_view'
          ]
        },
        {
          id: 'contact_delete',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_DELETE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view'
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
          id: 'contact_bulk_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_CREATE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_BULK_CREATE_CONTACT_DESCRIPTION',
          requires: [
            'outbreak_view',
            'contact_list'
          ]
        },

        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // OLD - MUST DELETE!!!!!!!!
        // - must delete TOKENS tooo
        {
          id: 'read_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT_DESCRIPTION'
        },
        {
          id: 'write_contact',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT_DESCRIPTION'
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
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_list',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_LIST_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_create',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_CREATE_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view'
          ]
        },
        {
          id: 'relationship_modify',
          label: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_RELATIONSHIP',
          description: 'LNG_ROLE_AVAILABLE_PERMISSIONS_MODIFY_RELATIONSHIP_DESCRIPTION',
          requires: [
            'outbreak_view',
            'relationship_view'
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



    // TO BE CHANGED
    {
      groupAllId: '---_all',
      groupLabel: '---label',
      groupDescription: '---D',
      permissions: [
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
      ]
    }
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
    const disallowedPermissions = [];
    if (
      this.permissionIds &&
      Array.isArray(this.permissionIds)
    ) {
      this.permissionIds.forEach(function (permission) {
        if (Role.allAllowedPermissions.indexOf(permission) === -1) {
          disallowedPermissions.push(permission);
        }
        if (disallowedPermissions.length) {
          error();
        }
      });
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
};
