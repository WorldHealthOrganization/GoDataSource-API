'use strict';

const app = require('../../server/server');

module.exports = function (AuditLog) {

  AuditLog.actions = {
    created: 'LNG_AUDIT_LOG_ACTIONS_CREATED',
    modified: 'LNG_AUDIT_LOG_ACTIONS_MODIFIED',
    removed: 'LNG_AUDIT_LOG_ACTIONS_REMOVED'
  };
};
