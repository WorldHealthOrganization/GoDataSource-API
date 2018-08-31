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
    // cache backup model reference
    const backupModel = app.models.backup;

    // defensive checks
    params = params || {};

    // get the id of the authenticated user from request options
    let userId = requestOptions.accessToken.userId;

    // retrieve system settings, fallback on default data backup settings, if not available in the request
    app.models.systemSettings
      .findOne()
      .then((systemSettings) => {
        params.location = params.location || systemSettings.dataBackup.location;
        params.modules = params.modules || systemSettings.dataBackup.modules;

        // create new backup record with pending status
        backupModel
          .create({
            date: Date.now(),
            modules: params.modules,
            location: null,
            userId: userId,
            status: backupModel.status.PENDING
          })
          .then((record) => {
            // start the backup process
            // when done update backup status and file location
            backup.create(params.modules, params.location, (err, backupFilePath) => {
              let newStatus = backupModel.status.SUCCESS;
              if (err) {
                newStatus = backupModel.status.FAILED;
              }
              record.updateAttributes({status: newStatus, location: backupFilePath});
            });
            // send the response back to the user, do not wait for the backup to finish
            return done(null, record.id);
          })
          .catch((createError) => done(createError));
      });
  };

  /**
   * Restore a backup from database using its ID
   * @param backupId
   * @param done
   */
  Backup.restoreBackup = function (backupId, done) {
    backup.restore(backupId, (err) => {
      if (err) {
        return done(err);
      }
      // remove backup record and file
      app.models.backup
        .findById(backupId)
        .then((restoredBackup) => backup.remove(restoredBackup));

      return done();
    });
  };
};
