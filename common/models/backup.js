'use strict';

// requires
const fs = require('fs');

module.exports = function (Backup) {
  Backup.hasController = true;

  // list of backup statuses
  Backup.status = {
    SUCCESS: 0,
    FAILED: 1,
    PENDING: 2
  };

  // application modules and their corresponding database collections
  // a module can group one or more collections
  Backup.modules = {
    'System Configuration': [
      'systemSettings',
      'language',
      'languageToken',
      'referenceData',
      'helpCategory',
      'auditLog'
    ],
    'Data': [
      'template',
      'icon',
      'outbreak',
      'person',
      'labResult',
      'followUp',
      'relationship',
      'team',
      'location',
      'user',
      'role',
      'cluster'
    ]
  };
};
