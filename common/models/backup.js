'use strict';

module.exports = function (Backup) {
  Backup.hasController = true;

  // list of backup statuses
  Backup.status = {
    SUCCESS: 'LNG_BACKUP_STATUS_SUCCESS',
    FAILED: 'LNG_BACKUP_STATUS_FAILED',
    PENDING: 'LNG_BACKUP_STATUS_PENDING'
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
