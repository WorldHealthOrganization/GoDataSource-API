'use strict';

// requires
const CronJob = require('node-cron').CronJob;
const async = require('async');

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

              // schedule the backup cron
              let backupCron = new CronJob(`* * ${backupIntervalHours} * * *`, function () {
                backup.createBackup(null, backupSettings.modules, backupSettings.location);
              });

              // schedule the backup cleanup cron
              let backupCleanupCron = new CronJob(`* * * ${retentionIntervalDays} * *`, function () {
                backup.removeBackups(Date.now());
              });

              // start the backup cron jobs
              backupCron.start();
              backupCleanupCron.start();
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


