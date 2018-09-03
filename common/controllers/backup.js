'use strict';

// requires
const app = require('../../server/server');
const backup = require('../../components/backup');

module.exports = function (Backup) {

  // Only list endpoint
  app.utils.remote.disableRemoteMethods(Backup, [
    'create',
    'prototype.patchAttributes',
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

    /**
     * Helper function used to create backup
     * Needed to not write the functionality multiple times in case of if condition
     */
    const createBackup = function (modules, location) {
      // create new backup record with pending status
      backupModel
        .create({
          date: Date.now(),
          modules: modules,
          location: null,
          userId: userId,
          status: backupModel.status.PENDING
        })
        .then((record) => {
          // start the backup process
          // when done update backup status and file location
          backup.create(params.modules, location, (err, backupFilePath) => {
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
    };

    // retrieve system settings, fallback on default data backup settings, if not available in the request
    if (params.location && params.modules) {
      createBackup(params.location, params.modules);
    } else {
      models.systemSettings
        .findOne()
        .then((systemSettings) => {
          let location = params.location || systemSettings.dataBackup.location;
          let modules = params.modules || systemSettings.dataBackup.modules;
          createBackup(location, modules);
        });
    }
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
      return done();
    });
  };

  /**
   * Removes a backup entry from database and from file system
   * @param backupId
   * @param done
   */
  Backup.removeBackup = function (backupId, done) {
    const backupModel = app.models.backup;
    backupModel
      .findOne({
        where: {
          id: backupId
        }
      })
      .then((backup) => {
        if (!backup) {
          return done(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: backupModel.modelName,
            id: backupId
          }));
        }

        // remove the backup
        backup.removeBackup(backup, done);
      })
      .catch((err) => done(err));
  };
};
