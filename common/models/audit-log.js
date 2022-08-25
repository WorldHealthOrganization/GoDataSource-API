'use strict';

module.exports = function ( AuditLog )
{
  AuditLog.fieldLabelsMap = Object.assign( {}, AuditLog.fieldLabelsMap, {
    'action': 'LNG_AUDIT_LOG_FIELD_LABEL_ACTION',
    'modelName': 'LNG_AUDIT_LOG_FIELD_LABEL_MODEL_NAME',
    'recordId': 'LNG_AUDIT_LOG_FIELD_LABEL_MODEL_ID',
    'changedData': 'LNG_AUDIT_LOG_FIELD_LABEL_CHANGE_DATA',
    'userId': 'LNG_AUDIT_LOG_FIELD_LABEL_USER',
    'userIPAddress': 'LNG_AUDIT_LOG_FIELD_LABEL_IP_ADDRESS'
  } );

  AuditLog.actions = {
    created: 'LNG_AUDIT_LOG_ACTIONS_CREATED',
    modified: 'LNG_AUDIT_LOG_ACTIONS_MODIFIED',
    removed: 'LNG_AUDIT_LOG_ACTIONS_REMOVED',
    restored: 'LNG_AUDIT_LOG_ACTIONS_RESTORED'
  };
};
