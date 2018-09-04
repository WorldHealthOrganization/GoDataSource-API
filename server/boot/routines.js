'use strict';

// requires
const moment = require('moment');
const async = require('async');
const fs = require('fs');
const path = require('path');

// function used to check if a routine should be executed or not
// if executed return an execution time, needed for further execution
const shouldExecute = function (startTime, interval, timeUnit) {
  // map of time unit and moment functions to measure the duration
  let unitsMap = {
    h: 'hours',
    m: 'minutes',
    d: 'days'
  };
  return moment.duration(moment().diff(startTime))[unitsMap[timeUnit]]() > interval;
};

module.exports = function (app) {
  // routines configuration file path
  let routinesConfigFilePath = path.resolve(__dirname, '../routines.json');

  // routines config
  let routinesConfig;

  // load the backup module
  let backup = require('../../components/backup');

  // routines to be executed
  let routines = [
    (done) => {
      // run pre routine functionality for backup create
      backup.preRoutine((err, backupSettings) => {
        if (err) {
          app.logger.warn('Failed to setup backup create job');
          return done();
        }

        // backup interval is in hours
        const interval = backupSettings.backupInterval;

        // if intervals are 0, then don't schedule
        if (interval < 1) {
          // remove the old backup routine configuration
          delete routinesConfig.backup;
          app.logger.warn('Backup interval is less than configured threshold.');
          return done();
        }

        // if routines configuration doesn't exist, create it
        if (!routinesConfig.backup) {
          routinesConfig.backup = {
            startTime: moment(),
            lastExecutedTime: null,
            timeUnit: 'h',
            interval: interval
          };
        }

        // cache routines backup config
        let backupRoutineConfig = routinesConfig.backup;

        // if routine was executed at least once, used that date as base date for checks
        let baseTime = backupRoutineConfig.lastExecutedTime ? backupRoutineConfig.lastExecutedTime : backupRoutineConfig.startTime;

        if (shouldExecute(baseTime, backupRoutineConfig.interval, backupRoutineConfig.timeUnit)) {
          // save the last execution time to now
          backupRoutineConfig.lastExecutedTime = moment();

          // cache backup model, used in many places below
          const backupModel = app.models.backup;

          // create new backup record with pending status
          backupModel
            .create({
              date: Date.now(),
              modules: backupSettings.modules,
              location: null,
              userId: null,
              status: backupModel.status.PENDING
            })
            .then((record) => {
              // start the backup process
              // when done update backup status and file location
              backup.create(backupSettings.modules, backupSettings.location, (err, backupFilePath) => {
                let newStatus = backupModel.status.SUCCESS;
                if (err) {
                  newStatus = backupModel.status.FAILED;
                }
                record.updateAttributes({status: newStatus, location: backupFilePath});
              });
            });
        }
        return done();
      });
    },
    (done) => {
      // run pre routine functionality for backup cleanup
      backup.preRoutine((err, backupSettings) => {
        if (err) {
          app.logger.warn('Failed to setup backup create job');
          return done();
        }

        // backup retention interval is in days
        const interval = backupSettings.dataRetentionInterval;

        // if intervals are 0, then don't schedule
        if (interval < 1) {
          // remove the old backup routine configuration
          delete routinesConfig.backup;
          app.logger.warn('Backup retention interval is less than configured threshold.');
          return done();
        }

        // if routines configuration doesn't exist, create it
        if (!routinesConfig.backupCleanup) {
          routinesConfig.backupCleanup = {
            startTime: moment(),
            lastExecutedTime: null,
            timeUnit: 'd',
            interval: interval
          };
        }

        // cache routines backup config
        let backupRoutineConfig = routinesConfig.backupCleanup;

        // if routine was executed at least once, used that date as base date for checks
        let baseTime = backupRoutineConfig.lastExecutedTime ? backupRoutineConfig.lastExecutedTime : backupRoutineConfig.startTime;

        if (shouldExecute(baseTime, backupRoutineConfig.interval, backupRoutineConfig.timeUnit)) {
          // save the last execution time to now
          backupRoutineConfig.lastExecutedTime = moment();

          // remove older backups
          backup.removeBackups(new Date());
        }
        return done();
      });
    }
  ];

  // endless loop, running every 2 minutes
  setInterval(() => {
    try {
      routinesConfig = JSON.parse(fs.readFileSync(routinesConfigFilePath));

      // run the configured routines
      async.parallel(
        routines,
        () => {
          // write the routines config back to file
          // to make sure any changes are persistent from tick to tick
          try {
            fs.writeFileSync(routinesConfigFilePath, JSON.stringify(routinesConfig));
          } catch (writeErr) {
            app.logger.warn(`Failed to write routines configuration. ${writeErr}`);
          }
        }
      );
    } catch (readErr) {
      app.logger.error(`Failed to read routines configuration. ${readErr}`);
    }
  }, 120000);
};
