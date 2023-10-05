'use strict';

// requires
const app = require('../../server/server');
const backup = require('../../components/backup');
const helpers = require('../../components/helpers');
const path = require('path');
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (Backup) {

  // Only list endpoint
  app.utils.remote.disableRemoteMethods(Backup, [
    'create',
    'prototype.patchAttributes',
    'deleteById'
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

    // check for received params; we need to retrieve location and modules from system settings if they are missing from params
    // initialize backup settings promise
    let getBackupSettings = Promise.resolve();
    if (!params.location || !params.modules) {
      getBackupSettings = app.models.systemSettings
        .findOne()
        .then(function (record) {
          // initialize error
          if (!record) {
            return Promise.reject(app.utils.apiError.getError('INTERNAL_ERROR', {
              error: 'System Settings were not found'
            }));
          }

          return record;
        });
    }

    // get backup setting
    getBackupSettings
      .then(function (systemSettings) {
        // get backup location and modules to be used
        let backupLocation = params.location || systemSettings.dataBackup.location;
        let backupModules = params.modules || systemSettings.dataBackup.modules;

        // validate location before starting backup creation
        // initialize resolved location
        let resolvedLocation;
        try {
          resolvedLocation = path.resolve(backupLocation);
          helpers.isPathOK(resolvedLocation);
        } catch (err) {
          // return error
          return Promise.reject(app.utils.apiError.getError(
            'REQUEST_VALIDATION_ERROR_INVALID_BACKUP_LOCATION', {
              errorMessages: `Configured backup location '${backupLocation}' is not accessible for read/write`,
              backupLocation: {
                path: backupLocation,
                resolvedPath: resolvedLocation,
                error: err
              }
            }
          ));
        }

        // backup setting are valid; create backup
        backupModel.createBackup(backupLocation, backupModules, userId, params.description, done);
      })
      .catch(function (err) {
        return done(err);
      });
  };

  /**
   * Restore a backup from database using its ID
   */
  Backup.prototype.restoreBackup = function (asynchronous, requestOptions, done) {
    app.models.databaseActionLog
      .create({
        type: 'restore-db',
        backupId: this.id,
        actionStartDate: localizationHelper.now().toDate(),
        status: 'LNG_SYNC_STATUS_IN_PROGRESS',
        statusStep: 'LNG_STATUS_STEP_PREPARING_RESTORE',
        totalNo: 0,
        processedNo: 0,
        deleted: false,
        createdAt: localizationHelper.now().toDate(),
        createdBy: requestOptions.accessToken.userId,
        updatedAt: localizationHelper.now().toDate(),
        dbUpdatedAt: localizationHelper.now().toDate(),
        updatedBy: requestOptions.accessToken.userId
      })
      .then((actionLog) => {
        if (asynchronous) {
          // restore
          backup.restore(
            this.id,
            actionLog.id,
            (err) => {
              // error ?
              if (err) {
                actionLog.updateAttributes({
                  status: 'LNG_SYNC_STATUS_FAILED',
                  error: err.message,
                  errStack: err.stack,
                  updatedAt: localizationHelper.now().toDate(),
                  dbUpdatedAt: localizationHelper.now().toDate()
                });

                // finished
                return;
              }

              // finished with success
              actionLog.updateAttributes({
                status: 'LNG_SYNC_STATUS_SUCCESS',
                statusStep: 'LNG_STATUS_STEP_RESTORE_FINISHED',
                updatedAt: localizationHelper.now().toDate(),
                dbUpdatedAt: localizationHelper.now().toDate(),
                actionCompletionDate: localizationHelper.now().toDate()
              });
            }
          );

          // finalize
          done(
            undefined,
            actionLog.id
          );
        } else {
          backup.restore(
            this.id,
            actionLog.id,
            (err) => {
              // error ?
              if (err) {
                actionLog.updateAttributes({
                  status: 'LNG_SYNC_STATUS_FAILED',
                  error: err.message,
                  errStack: err.stack,
                  updatedAt: localizationHelper.now().toDate(),
                  dbUpdatedAt: localizationHelper.now().toDate()
                });

                // finished
                return done(err);
              }

              // finished with success
              actionLog.updateAttributes({
                status: 'LNG_SYNC_STATUS_SUCCESS',
                statusStep: 'LNG_STATUS_STEP_RESTORE_FINISHED',
                updatedAt: localizationHelper.now().toDate(),
                dbUpdatedAt: localizationHelper.now().toDate(),
                actionCompletionDate: localizationHelper.now().toDate()
              });

              // finished
              return done(
                undefined,
                actionLog.id
              );
            }
          );
        }
      })
      .catch(done);
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

  /**
   * Go through all records and attach the custom properties
   */
  Backup.afterRemote('find', function (context, modelInstances, next) {
    // go through all records and attach the custom properties
    (modelInstances || []).forEach((filterMappingModel) => {
      app.models.backup.attachCustomProperties(filterMappingModel);
    });

    // finished - continue
    next();
  });
};
