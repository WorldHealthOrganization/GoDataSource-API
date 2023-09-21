'use strict';

const app = require('../../server/server');
const backupHelper = require('../../components/backup');
const fs = require('fs');
const localizationHelper = require('../../components/localizationHelper');

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
      'helpItem',
      'auditLog',
      'template',
      'icon',
      'device',
      'deviceHistory',
      'importMapping',
      'filterMapping',
      'migrationLog'
    ],
    'Data': [
      'outbreak',
      'person',
      'labResult',
      'followUp',
      'relationship',
      'team',
      'location',
      'user',
      'role',
      'cluster',
      'fileAttachment',
      'transmissionChain'
    ]
  };

  /**
   * Helper function used to create backup
   * Needed to not write the functionality multiple times in case of if condition
   * Cane be used with a callback function (done) or as a promise
   * @param location
   * @param modules
   * @param userId
   * @param description
   * @param done Optional callback; if sent will be called immediately after the backup creation is triggered
   */
  Backup.createBackup = function (location, modules, userId, description, done) {
    let cb = done;

    // create new backup record with pending status
    let createBackup = Backup
      .create({
        date: Date.now(),
        modules: modules,
        location: null,
        userId: userId,
        status: Backup.status.PENDING,
        description
      })
      .then((record) => {
        // send the response back to the user, do not wait for the backup to finish
        if (cb) {
          cb(null, record.id);
          // make cb a noop function as it might also be called on catch
          cb = () => {
          };
        }
        app.logger.debug(`Backup ${record.id}: Started the backup process`);

        // start the backup process
        // when done update backup status and file location
        return new Promise(function (resolve, reject) {
          // keep backup start time
          const startedAt = localizationHelper.now();

          // start creating backup
          backupHelper.create(modules, location, (err, backupFilePath) => {
            let newStatus = Backup.status.SUCCESS;
            let failReason = '';
            if (err) {
              newStatus = Backup.status.FAILED;
              failReason = err;
              app.logger.error(`Backup ${record.id}: Backup process failed with error`, {error: err});
            } else {
              app.logger.debug(`Backup ${record.id}: Successfully created backup file at ${backupFilePath}`);
            }


            record.updateAttributes({
              status: newStatus,
              location: backupFilePath,
              error: failReason ?
                failReason.message ?
                  failReason.message :
                  JSON.stringify(failReason) :
                '',
              startedAt: startedAt,
              endedAt: localizationHelper.now()
            })
              .then(function (record) {
                app.logger.debug(`Backup ${record.id}: Successfully updated backup entry status`);
                // resolve/reject promise
                if (err) {
                  reject(err);
                } else {
                  // return record entry
                  resolve(record);
                }
              })
              .catch(function (err) {
                app.logger.error(`Backup ${record.id}: Failed updating backup entry status. Error: ${err}`);
                reject(err);
              });
          });
        });
      });

    // check for done function; if sent will be called on error only if it was not already called
    if (cb) {
      return createBackup
        .catch((createError) => cb(createError));
    } else {
      return createBackup;
    }
  };

  /**
   * Attach custom properties
   */
  Backup.attachCustomProperties = function (record) {
    // determine file size
    let sizeBytes;
    try {
      if (fs.existsSync(record.location)) {
        const stats = fs.statSync(record.location);
        sizeBytes = stats.size;
      }
    } catch (e) {
      app.logger.error(`Can't determine backup size ( ${record.id} )`);
      sizeBytes = undefined;
    }

    // set backup size
    record.sizeBytes = sizeBytes;
  };

  // after the application started (all models finished loading)
  app.on('started', function () {
    // fail any in progress actions;
    Backup
      .updateAll({
        status: 'LNG_BACKUP_STATUS_PENDING'
      }, {
        status: 'LNG_BACKUP_STATUS_FAILED',
        error: 'Application was restarted before finalizing processing data'
      })
      .then(function (info) {
        app.logger.debug(`Startup: ${info.count} sync/export actions that were 'in progress' after application restart. Changed status to failed`);
      })
      .then(() => {
        // not our main thread ?
        if (!app.startScheduler) {
          return;
        }

        // check if we need to reset scheduler.json
        return Backup
          .find({
            where: {
              automatic: true
            },
            fields: {
              id: true,
              status: true
            },
            limit: 1,
            order: 'createdAt DESC'
          })
          .then((backups) => {
            // check if we have a failed backup
            if (
              !backups ||
              backups.length < 1 ||
              backups[0].status !== 'LNG_BACKUP_STATUS_FAILED'
            ) {
              return;
            }

            // if we do, we need to reset scheduler.json so it start a new backup
            app.clearLastExecutedTime = true;
          });
      })
      .catch(function (err) {
        app.logger.debug(`Startup: Update of 'in progress' sync/export actions status failed. Error: ${err}`);
      });
  });
};
