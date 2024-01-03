'use strict';

const app = require('../../server');
const common = require('./_common');
const SystemSettings = app.models.systemSettings;
const defaultSettings = {
  'upstreamServers': [],
  'sync': {
    'triggerBackupBeforeSync': false
  },
  'dataBackup': {
    'modules': [
      'System Configuration',
      'Data'
    ],
    'disabled': false,
    'backupInterval': 24,
    'dataRetentionInterval': 90,
    'location': `${__dirname}/../../../backups`
  },
  'anonymizeFields': {
    'case': [
      'firstName',
      'middleName',
      'lastName',
      'addresses[].addressLine1'
    ],
    'contact': [
      'firstName',
      'middleName',
      'lastName',
      'addresses[].addressLine1'
    ]
  },
  'dbVersion': '1.0.0'
};

// initialize action options; set _init flag to prevent execution of some after save scripts
let options = {
  _init: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {

  /**
   * Install default settings
   */
  SystemSettings
    .findOne()
    .then(function (systemSettings) {
      if (systemSettings) {
        return systemSettings.updateAttributes(defaultSettings, options);
      } else {
        return SystemSettings.create(Object.assign(defaultSettings, common.install.timestamps), options);
      }
    })
    .then(function () {
      console.log('Install Default System Settings');
      callback();
    })
    .catch(callback);
}

module.exports = run;
