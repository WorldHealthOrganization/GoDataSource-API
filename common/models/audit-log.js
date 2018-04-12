'use strict';

const app = require('../../server/server');

module.exports = function(AuditLog) {

  AuditLog.actions = {
    created: 'New Record',
    modified: 'Record Modified',
    removed: 'Record Removed'
  };

  // Audit Log has only read-only endpoints
  app.utils.remote.disableRemoteMethods(AuditLog, ['create', 'prototype.patchAttributes', 'findById', 'deleteById']);

};
