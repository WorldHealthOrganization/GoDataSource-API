'use strict';

// requires
const app = require('../../server/server');

module.exports = function (Backup) {

  // Only list endpoint
  app.utils.remote.disableRemoteMethods(Backup, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'count'
  ]);


  /**
   * Create a backup of the application
   * The following request body params are configurable (if any is missing, fallback on system settings):
   * - location Absolute location of the backup file
   * - modules Application modules to backup
   * @param params
   * @param done
   * @returns {*}
   */
  Backup.createBackup = function (params, done) {
    // defensive checks
    params = params || {};

    // retrieve system settings, used to fallback on default data backup settings, if not available in the request
    app.models.systemSettings
      .findOne()
      .then((systemSettings) => {
        params.location = params.location || systemSettings.dataBackup.location;
        params.modules = params.modules || systemSettings.dataBackup.modules;

        // collect all collections that must be exported, based on the modules
        let collections = [].concat(...params.modules.map((module) => Backup.modules[module]));

        let a = 1;
      });
  };
};
