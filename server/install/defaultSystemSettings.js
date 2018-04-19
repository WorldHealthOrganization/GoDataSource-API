'use strict';

const app = require('../server');
const SystemSettings = app.models.systemSettings;
const defaultSettings = {
  "upstreamServer": {
    "name": "",
    "description": "",
    "url": "",
    "credentials": {
      "clientId": "",
      "clientSecret": ""
    },
    "syncInterval": 0,
    "syncOnEveryChange": false
  },
  "clientApplications": [ ],
  "dataBackup": {
    "modules": [
      "System Configuration",
      "Data"
    ],
    "backupInterval": 24,
    "dataRetentionInterval": 90,
    "location": ""
  }
};

/**
 * Add default settings
 */
SystemSettings
  .create(defaultSettings)
  .then(function () {
    process.stdout.write(`Added Default System Settings`);
    process.exit();
  });
