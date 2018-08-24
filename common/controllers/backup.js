'use strict';

// requires
const app = require('../../server/server');
const backup = require('../../components/backup');

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
   * @param requestOptions
   * @param done
   * @returns {*}
   */
  Backup.createManualBackup = function (params, requestOptions, done) {
    // defensive checks
    params = params || {};

    // get the id of the authenticated user from request options
    let userId = requestOptions.accessToken.userId;

    // retrieve system settings, used to fallback on default data backup settings, if not available in the request
    app.models.systemSettings
      .findOne()
      .then((systemSettings) => {
        params.location = params.location || systemSettings.dataBackup.location;
        params.modules = params.modules || systemSettings.dataBackup.modules;

        // create new backup
        backup.create(userId, params.modules, params.location, (err, backupId) => done(err, backupId));
      });
  };

  /**
   * Restore the system from a given backup file
   * @param req
   * @param backupFile
   * @param done
   */
  Backup.restoreBackupFromFile = function (req, backupFile, done) {
    const buildError = app.utils.apiError.getError;
    const form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
      if (err) {
        return done(err);
      }

      // validates snapshot archive
      if (!files.backupFile) {
        // send back the error
        return done(buildError('MISSING_REQUIRED_PROPERTY', {
          model: Backup.modelName,
          properties: 'backupFile'
        }));
      }


  };
};
