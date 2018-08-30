'use strict';

// requires
const cron = require('node-cron');
const async = require('async');
const fs = require('fs');

module.exports = function (app) {
  // build list of routines to be executed
  async.series([
    (done) => {
      // retrieve system settings and get backup timings
      app.models.systemSettings
        .findOne()
        .then((systemSettings) => {
          if (systemSettings.dataBackup) {
            // cache backup settings
            let backupSettings = systemSettings.dataBackup;

            // backup interval is in hours
            let backupIntervalHours = backupSettings.backupInterval;

            // retention interval is in days
            let retentionIntervalDays = backupSettings.dataRetentionInterval;

            // make sure the backup location is ok, otherwise don't schedule the job
            fs.access(backupSettings.location, fs.F_OK, (accessError) => {
              if (accessError) {
                app.logger.error(`Configured backup location: ${backupSettings.location} is not OK. ${accessError}`);
                return done(accessError);
              }

              // load the backup module
              let backup = require('../../components/backup');

              // if intervals are 0, then don't schedule
              if (backupIntervalHours >= 1) {
                app.logger.debug('Scheduled automatic backup');
                // schedule the backup cron
                let backupCron = cron.schedule(`1 * * * * *`, function () {
                  const backupModel = app.models.backup;

                  // create new backup record with pending status
                  backupModel
                    .create(
                      {
                        date: Date.now(),
                        modules: backupSettings.modules,
                        location: null,
                        userId: null,
                        status: backupModel.status.PENDING
                      }
                    )
                    .then((record) => {
                      // start the backup process
                      // when done update backup status and file location
                      backup.create(backupSettings.modules, backupSettings.location, (err, backupFilePath) => {
                        let newStatus = backupModel.status.SUCCESS;
                        if (err) {
                          newStatus = backupModel.status.FAILED;
                        }
                        record.updateAttributes({ status: newStatus, location: backupFilePath });
                      });
                    });
                });
                backupCron.start();
              }
              if (retentionIntervalDays) {
                app.logger.debug('Scheduled automatic backup cleanup');

                // schedule the backup cleanup cron
                let backupCleanupCron = cron.schedule(`* * * ${retentionIntervalDays} * *`, function () {
                  backup.removeBackups(new Date());
                });
                backupCleanupCron.start();
              }
            });
          }
        });
    }
  ], (err) => {
    if (err) {
      app.logger.error(`Failed to setup cron jobs. ${err}`);
    }
  });
};


