'use strict';

module.exports = function(AuditLog) {

  AuditLog.actions = {
    created: 'New Record',
    modified: 'Record Modified',
    removed: 'Record Removed'
  };

};
