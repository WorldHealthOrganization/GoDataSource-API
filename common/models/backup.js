'use strict';

const app = require('../../server/server');
const backupHelper = require('../../components/backup');
const fs = require('fs');

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
      'auditLog',
      'template',
      'icon',
      'device',
      'deviceHistory',
      'importMapping'
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
      'fileAttachment'
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
        done && done(null, record.id);
        app.logger.debug(`Backup ${record.id}: Started the backup process`);

        // start the backup process
        // when done update backup status and file location
        return new Promise(function (resolve, reject) {
          backupHelper.create(modules, location, (err, backupFilePath) => {
            let newStatus = Backup.status.SUCCESS;
            let failReason = '';
            if (err) {
              newStatus = Backup.status.FAILED;
              failReason = err;
              app.logger.debug(`Backup ${record.id}: Backup process failed with error: ${err}`);
            } else {
              app.logger.debug(`Backup ${record.id}: Successfully created backup file at ${backupFilePath}`);
            }

            record.updateAttributes({status: newStatus, location: backupFilePath, error: failReason})
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
                app.logger.debug(`Backup ${record.id}: Failed updating backup entry status. Error: ${err}`);
                reject(err);
              });
          });
        });
      });

    // check for done function; if sent call it on error
    if (done) {
      return createBackup
        .catch((createError) => done(createError));
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
};
