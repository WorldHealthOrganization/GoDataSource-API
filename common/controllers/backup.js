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

    // retrieve system settings, fallback on default data backup settings, if not available in the request
    if (params.location && params.modules) {
      backupModel.createBackup(params.location, params.modules, userId, done);
    } else {
      app.models.systemSettings
        .findOne()
        .then((systemSettings) => {
          let location = params.location || systemSettings.dataBackup.location;
          let modules = params.modules || systemSettings.dataBackup.modules;
          backupModel.createBackup(location, modules, userId, done);
        });
    }
  };

  /**
   * Restore a backup from database using its ID
   * @param done
   */
  Backup.prototype.restoreBackup = function (done) {
    backup.restore(this.id, (err) => {
      if (err) {
        return done(err);
      }
      return done();
    });
  };

  /**
   * Removes a backup entry from database and from file system
   * @param done
   */
  Backup.prototype.removeBackup = function (done) {
    const backupModel = app.models.backup;
    const backupId = this.id;
    backupModel
      .findOne({
        where: {
          id: backupId
        }
      })
      .then((backupItem) => {
        if (!backupItem) {
          return done(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: backupModel.modelName,
            id: backupId
          }));
        }

        // remove the backup
        backup.remove(backupItem, done);
      })
      .catch((err) => done(err));
  };
};
