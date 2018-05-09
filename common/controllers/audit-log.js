'use strict';

const app = require('../../server/server');

module.exports = function (AuditLog) {

  // Audit Log has only read-only endpoints
  app.utils.remote.disableRemoteMethods(AuditLog, ['create', 'prototype.patchAttributes', 'findById', 'deleteById']);
};
