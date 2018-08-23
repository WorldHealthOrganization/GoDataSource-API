'use strict';

module.exports = function (Backup) {
  Backup.hasController = true;

  // application modules and their corresponding database collections
  // a module can group one or more collections
  Backup.modules = {
    'System Configuration': [
      'systemSettings',
      'language',
      'languageToken',
      'referenceData',
      'helpCategory'
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
