'use strict';

module.exports = function ( AuditLog )
{
  // tokens
  AuditLog.fieldLabelsMap = Object.assign( {}, AuditLog.fieldLabelsMap, {
    'action': 'LNG_AUDIT_LOG_FIELD_LABEL_ACTION',
    'modelName': 'LNG_AUDIT_LOG_FIELD_LABEL_MODEL_NAME',
    'recordId': 'LNG_AUDIT_LOG_FIELD_LABEL_MODEL_ID',
    'changedData': 'LNG_AUDIT_LOG_FIELD_LABEL_CHANGE_DATA',
    'userIPAddress': 'LNG_AUDIT_LOG_FIELD_LABEL_IP_ADDRESS',
    'user': 'LNG_AUDIT_LOG_FIELD_LABEL_USER',
    'user.id': 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    'user.firstName': 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    'user.lastName': 'LNG_USER_FIELD_LABEL_LAST_NAME',
    'user.email': 'LNG_USER_FIELD_LABEL_EMAIL'
  } );

  // actions
  AuditLog.actions = {
    created: 'LNG_AUDIT_LOG_ACTIONS_CREATED',
    modified: 'LNG_AUDIT_LOG_ACTIONS_MODIFIED',
    removed: 'LNG_AUDIT_LOG_ACTIONS_REMOVED',
    restored: 'LNG_AUDIT_LOG_ACTIONS_RESTORED'
  };
};
