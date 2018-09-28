'use strict';

// requires
const moment = require('moment');
const async = require('async');
const fs = require('fs');
const path = require('path');
const syncActionsSettings = require('../../server/config.json').sync;
const SyncClient = require('../../components/syncClient');

// function used to check if a routine should be executed or not
// if executed return an execution time, needed for further execution
const shouldExecute = function (startTime, interval, timeUnit) {
  // map of time unit and moment functions to measure the duration
  let unitsMap = {
    h: 'hours',
    m: 'minutes',
    d: 'days'
  };
  return moment.duration(moment().diff(startTime))[unitsMap[timeUnit]]() >= interval;
};

// initialize ID to be set as createdBy for automatic sync
const automaticSyncID = 'Scheduled automatic sync';

module.exports = function (app) {
  /**
   * Trigger automatic sync
   * @param server
   */
  function triggerAutomaticSync(server) {
    // initialize sync params
    let data = {
      upstreamServerURL: server.url
    };
    // create options; Keeping only the details required for audit log
    let options = {
      remotingContext: {
        req: {
          authData: {
            user: {
              id: automaticSyncID
            }
          },
          headers: {},
          connection: {}
        }
      }
    };

    app.logger.debug(`Scheduled automatic sync: Started sync with server '${server.name}'`);
    // start the sync process
    app.models.sync.sync(data, options, function (err, syncLogId) {
      if (err) {
        app.logger.debug(`Scheduled automatic sync: Sync with server '${server.name}' failed with error: ${err}`);
      } else {
        app.logger.debug(`Scheduled automatic sync: Sync with server '${server.name}' is progressing having sync log ID ${syncLogId}`);
      }
    });
  }

  // routines configuration file path
  let routinesConfigFilePath = path.resolve(__dirname, 'scheduler.json');

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
          if (routinesConfig.backup) {
            delete routinesConfig.backup;
          }
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
        } else {
          // make sure the interval didn't change in the meantime
          routinesConfig.backup.interval = interval;
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
          if (routinesConfig.backupCleanup) {
            delete routinesConfig.backupCleanup;
          }
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
        } else {
          // make sure the interval didn't change in the meantime
          routinesConfig.backupCleanup.interval = interval;
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
    },
    // fail sync actions started more than a configured period ago
    (done) => {
      // get configuration param; action cleanup interval is in hours
      let actionCleanupInterval = syncActionsSettings.actionCleanupInterval || 24;

      // fail any in progress sync/export actions;
      // the sync/export action might have been successful and the sync/export log update action failed
      app.models.databaseActionLog
        .updateAll({
          status: 'LNG_SYNC_STATUS_IN_PROGRESS',
          actionStartDate: {
            lt: new Date(moment().subtract(actionCleanupInterval, 'hours'))
          }
        }, {
          status: 'LNG_SYNC_STATUS_FAILED',
          error: `Sync/export action was 'in progress' for more than ${actionCleanupInterval} hours`
        })
        .then(function (info) {
          app.logger.debug(`Scheduler: ${info.count} sync/export actions that were 'in progress' for more than ${actionCleanupInterval} hours. Changed status to failed`);
        })
        .catch(function (err) {
          app.logger.debug(`Scheduler: Update of 'in progress' sync/export actions status failed. Error: ${err}`);
        });

      return done();
    },
    // run automatic sync after the configured period of time
    (done) => {
      // get system settings
      app.models.systemSettings
        .getCache()
        .then(function (systemSettings) {
          // initialize routinesConfig entry for sync if not already initialize
          routinesConfig.sync = routinesConfig.sync || {};

          // get upstream servers that have sync enabled and syncInterval configured (!==0)
          let serversToSync = systemSettings.upstreamServers.filter(function (server) {
            return server.syncEnabled && server.syncInterval > 0;
          });

          // loop through the servers to sync an start the sync if the required time has passed
          // if no entry for the server is found in the routinesConfig then add an entry for the server
          serversToSync.forEach(function (server) {
            // check if there is an entry for the server in the routinesConfig
            if (routinesConfig.sync[server.url]) {
              // check schedule and start sync if needed
              // update interval as the systemSettings might have changed
              let routinesEntry = routinesConfig.sync[server.url];
              routinesEntry.interval = server.syncInterval;

              if (shouldExecute(routinesEntry.lastExecutedTime || routinesEntry.startTime, routinesEntry.interval, routinesEntry.timeUnit)) {
                // save the last execution time to now
                routinesEntry.lastExecutedTime = moment();

                triggerAutomaticSync(server);
              }
            } else {
              // create entry for the server in the routinesConfig with
              routinesConfig.sync[server.url] = {
                startTime: moment(),
                lastExecutedTime: null,
                timeUnit: 'h',
                interval: server.syncInterval
              };
            }
          });
        })
        .catch(function (err) {
          app.logger.debug(`Scheduler: Failed to schedule automatic sync. Error: ${err}`);
        });

      return done();
    },
    // start sync with upstream server if the latest automatic sync failed because of connection error
    (done) => {
      // get system settings
      app.models.systemSettings
        .getCache()
        .then(function (systemSettings) {
          // get upstream servers that have sync enabled and syncInterval configured (!==0)
          let serversToSync = systemSettings.upstreamServers.filter(function (server) {
            return server.syncEnabled && server.syncInterval > 0;
          });

          // initialize promises array
          let promises = [];

          // loop through the servers to sync and check if the latest automatic sync was failed
          serversToSync.forEach(function (server) {
            // get latest sync log entry
            promises.push(app.models.syncLog
              .findOne({
                where: {
                  syncServerUrl: server.url
                },
                order: 'actionStartDate DESC'
              })
              .then(function (syncLogEntry) {
                // check if the sync was an automatic sync and it failed with connection error
                if (syncLogEntry &&
                  syncLogEntry.status === 'LNG_SYNC_STATUS_FAILED' &&
                  syncLogEntry.createdBy === automaticSyncID &&
                  syncLogEntry.error.indexOf('EXTERNAL_API_CONNECTION_ERROR') !== -1
                ) {
                  app.logger.debug(`Scheduler: Latest automatic sync with server '${server.name}' failed with connection error. Checking if connection was re-established.`);

                  let client = new SyncClient(server, {
                    id: automaticSyncID
                  });
                  client
                    .getServerVersion()
                    .then(function () {
                      app.logger.debug(`Scheduler: Connection with server '${server.name}' was re-established. Triggering automatic sync`);
                      // trigger a new sync
                      triggerAutomaticSync(server);
                    })
                    .catch(function (err) {
                      app.logger.debug(`Scheduler: Connection with server '${server.name}' couldn't be re-established. Error: ${err}`);
                    });
                } else {
                  // nothing to do
                }
              })
            );
          });

          return Promise.all(promises);
        })
        .catch(function (err) {
          app.logger.debug(`Scheduler: Failed to check for failed automatic sync. Error: ${err}`);
        });

      return done();
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
