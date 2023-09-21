'use strict';

// requires
const async = require('async');
const fs = require('fs');
const path = require('path');
const configSettings = require('../../server/config.json');
const syncActionsSettings = configSettings.sync;
const SyncClient = require('../../components/syncClient');
const tmp = require('tmp');
const _ = require('lodash');
const localizationHelper = require('../../components/localizationHelper');

// function used to check if a routine should be executed or not
// if executed return an execution time, needed for further execution
const shouldExecute = function (startTime, interval, timeUnit) {
  // map of time unit and moment functions to measure the duration
  let unitsMap = {
    h: 'hours',
    m: 'minutes',
    d: 'days'
  };
  return localizationHelper.now().isAfter(localizationHelper.toMoment(startTime).add(interval, unitsMap[timeUnit]));
};

// initialize ID to be set as createdBy for automatic sync
const automaticSyncID = 'Scheduled automatic sync';

module.exports = function (app) {
  // when using cluster only one child process will start the scheduler
  if (!app.startScheduler) {
    app.logger.debug(`Process ${process.pid} will not start scheduler`);
    return;
  }
  app.logger.debug(`Process ${process.pid} starting scheduler`);

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
  let deleteAuditLogInProgress = false;

  // load the backup module
  let backup = require('../../components/backup');

  // routines to be executed
  let routines = [
    (done) => {
      // run pre routine functionality for backup create
      backup.preRoutine((err, backupSettings) => {
        if (err) {
          app.logger.error('Failed to setup backup create job', {error: err});
          return done();
        }

        // if automatic backup is off in the database or in the configuration file, then don't schedule
        if (
          backupSettings.disabled || (
            configSettings.backUp &&
            configSettings.backUp.disabled
          )
        ) {
          return done();
        }

        // determine if we need to execute backup creation
        let executeBackupCreation = false;
        if (
          !backupSettings.backupType ||
          backupSettings.backupType === 'n_hours'
        ) {
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
              startTime: localizationHelper.now(),
              lastExecutedTime: null,
              timeUnit: 'h',
              interval: interval,
              backupTime: null
            };
          } else {
            // make sure the interval didn't change in the meantime
            routinesConfig.backup.interval = interval;
            routinesConfig.backup.backupTime = null;
          }

          // clear last executed time ?
          if (app.clearLastExecutedTime) {
            // clear
            routinesConfig.backup.lastExecutedTime = null;

            // reset
            app.clearLastExecutedTime = false;
          }

          // cache routines backup config
          let backupRoutineConfig = routinesConfig.backup;

          // if routine was executed at least once, used that date as base date for checks
          let baseTime = backupRoutineConfig.lastExecutedTime ? backupRoutineConfig.lastExecutedTime : backupRoutineConfig.startTime;

          // determine if we need to execute
          executeBackupCreation = shouldExecute(baseTime, backupRoutineConfig.interval, backupRoutineConfig.timeUnit);
        } else if (
          backupSettings.backupType === 'daily_at_time' &&
          backupSettings.backupDailyAtTime
        ) {
          // time when backup should be done
          const backupTime = backupSettings.backupDailyAtTime;

          // if routines configuration doesn't exist, create it
          if (!routinesConfig.backup) {
            routinesConfig.backup = {
              startTime: localizationHelper.now(),
              lastExecutedTime: null,
              timeUnit: 'h',
              interval: null,
              backupTime: backupTime
            };
          } else {
            // make sure the interval didn't change in the meantime
            routinesConfig.backup.interval = null;
            routinesConfig.backup.backupTime = backupTime;
          }

          // clear last executed time ?
          if (app.clearLastExecutedTime) {
            // clear
            routinesConfig.backup.lastExecutedTime = null;

            // reset
            app.clearLastExecutedTime = false;
          }

          // determine time when we should execute today
          const whenBackupShouldBeDoneToday = localizationHelper.toMoment(
            `${localizationHelper.now().format('YYYY-MM-DD')} ${routinesConfig.backup.backupTime}:00`,
            'YYYY-MM-DD HH:mm:ss'
          );

          // check if we already executed today
          if (
            routinesConfig.backup.lastExecutedTime &&
            localizationHelper.toMoment(routinesConfig.backup.lastExecutedTime).isSameOrAfter(whenBackupShouldBeDoneToday)
          ) {
            // already created backup for today
            return done();
          }

          // need to create backup
          executeBackupCreation = localizationHelper.now().isSameOrAfter(whenBackupShouldBeDoneToday);
        } else {
          // can't do backup
          // - method not supported
          // remove the old backup routine configuration
          if (routinesConfig.backup) {
            delete routinesConfig.backup;
          }
          app.logger.warn('Automatic backup not configured properly, can\'t execute neither by n hours or at a specific time.');
          return done();
        }

        // create backup ?
        if (executeBackupCreation) {
          // save the last execution time to now
          routinesConfig.backup.lastExecutedTime = localizationHelper.now();

          // cache backup model, used in many places below
          const backupModel = app.models.backup;

          // create new backup record with pending status
          backupModel
            .create({
              date: Date.now(),
              modules: backupSettings.modules,
              location: null,
              userId: null,
              status: backupModel.status.PENDING,
              automatic: true,
              description: backupSettings.description
            })
            .then((record) => {
              // start the backup process
              // keep backup start date
              const startedAt = localizationHelper.now();

              // when done update backup status and file location
              backup.create(backupSettings.modules, backupSettings.location, (err, backupFilePath) => {
                let newStatus = backupModel.status.SUCCESS;
                let errorMsg = undefined;
                if (err) {
                  // try again later
                  app.clearLastExecutedTime = true;

                  // failed
                  errorMsg = err.message ?
                    err.message :
                    'An error occurred while creating backup';
                  newStatus = backupModel.status.FAILED;
                }

                // update status
                // & attach error information in case it failed and if we have any
                record.updateAttributes({
                  status: newStatus,
                  location: backupFilePath,
                  startedAt: startedAt,
                  endedAt: localizationHelper.now(),
                  error: errorMsg
                });
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
          app.logger.error('Failed to setup backup cleanup job', {error: err});
          return done();
        }

        // if automatic backup is off in the database or in the configuration file, then don't schedule
        if (
          backupSettings.disabled || (
            configSettings.backUp &&
            configSettings.backUp.disabled
          )
        ) {
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
            startTime: localizationHelper.now(),
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
          backupRoutineConfig.lastExecutedTime = localizationHelper.now();

          // remove backups which are older than the configured retention interval
          backup.removeBackups({
            where: {
              date: {
                lt: new Date(baseTime)
              },
              automatic: true
            }
          });
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
            lt: new Date(localizationHelper.now().subtract(actionCleanupInterval, 'hours'))
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
        .findOne()
        .then(function (systemSettings) {
          // initialize routinesConfig entry for sync if not already initialize
          routinesConfig.sync = routinesConfig.sync || {};
          systemSettings.upstreamServers = systemSettings.upstreamServers || [];

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
                routinesEntry.lastExecutedTime = localizationHelper.now();

                triggerAutomaticSync(server);
              }
            } else {
              // create entry for the server in the routinesConfig with
              routinesConfig.sync[server.url] = {
                startTime: localizationHelper.now(),
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
        .findOne()
        .then(function (systemSettings) {
          systemSettings.upstreamServers = systemSettings.upstreamServers || [];
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
    },

    // remove old snapshot files
    (done) => {
      // job for deleting old files that aren't needed anymore
      try {
        // determine after how much time we should remove snapshot files
        if (fs.existsSync(tmp.tmpdir)) {
          // used to determine when can we delete snapshot files
          const snapshotMatchRegex = /^snapshot_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}.zip$/i;
          const removeSyncSnapshotsAfterHours = configSettings.removeSyncSnapshotsAfter || 24;
          const deleteSnapshotBeforeDateTime = localizationHelper.now().subtract(removeSyncSnapshotsAfterHours, 'hours');

          // used to determine when can we delete snapshot files
          // fix for back-words compatibility, to remove old directories, that weren't deleted on time when zip was created
          const snapshotTmpDirMatchRegex = /^tmp-[a-zA-Z0-9_]{10,20}$/i;

          // used to determine when can we delete uploaded files with formidable.IncomingForm
          const uploadedMatchRegex = /^upload_[a-zA-Z0-9_]+$/i;
          const removeTmpUploadedFilesAfter = configSettings.removeTmpUploadedFilesAfter || 24;
          const deleteTmpUploadBeforeDateTime = localizationHelper.now().subtract(removeTmpUploadedFilesAfter, 'hours');

          // used to determine when can we delete uploaded files used to import data
          const uploadedImportMatchRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(_metadata)?$/i;
          const removeTmpUploadedImportFilesAfter = configSettings.removeTmpUploadedImportFilesAfter || 24;
          const deleteTmpUploadImportBeforeDateTime = localizationHelper.now().subtract(removeTmpUploadedImportFilesAfter, 'hours');

          // used to remove directory
          const removeDirectory = (dirToRemovePath) => {
            // remove directory and its content
            const removeDirectoryRecursive = (dirPath) => {
              if (fs.existsSync(dirPath)) {
                // fs.rmdirSync with "recursive: true" flag doesn't do the job properly...
                fs.readdirSync(dirPath).forEach(function (fileOrDirToRemovePath) {
                  const currentPath = `${dirPath}${path.sep}${fileOrDirToRemovePath}`;
                  if (fs.lstatSync(currentPath).isDirectory()) {
                    // remove directory content
                    removeDirectoryRecursive(currentPath);
                  } else {
                    // delete file
                    fs.unlinkSync(currentPath);
                  }
                });

                // remove main directory
                fs.rmdirSync(dirPath);
              }
            };

            // delete directory
            // no matter if it was a success or not
            try {
              removeDirectoryRecursive(dirToRemovePath);
            } catch (remErr) {
              // we don't have rights to delete directory or something has gone wrong...
              // log data and continue as God intended to be..without any worries...
              app.logger.debug(`Failed removing tmp uploaded directories: ${remErr}`);
            }
          };

          // used to check and delete files
          const deleteFileOrDirIfMatches = (
            fileOrDir,
            regexMatch,
            beforeDate
          ) => {
            // does this file match out search criteria ( snapshot or something else ? )
            const currentPath = `${tmp.tmpdir}${path.sep}${fileOrDir}`;
            if (
              regexMatch.test(fileOrDir) &&
              fs.existsSync(currentPath)
            ) {
              // check and delete old files
              const fileStats = fs.statSync(currentPath);
              if (
                fileStats.birthtime &&
                localizationHelper.toMoment(fileStats.birthtime).isBefore(beforeDate)
              ) {
                try {
                  // delete file / directory
                  if (fs.lstatSync(currentPath).isDirectory()) {
                    // delete directory
                    removeDirectory(currentPath);
                  } else {
                    // delete file
                    fs.unlinkSync(currentPath);
                  }
                } catch (remFileErr) {
                  // we don't have rights to delete file or something has gone wrong...
                  // log data and continue as God intended to be..without any worries...
                  app.logger.error(`Failed removing tmp file / directory: ${remFileErr}`);
                }
              }
            }
          };

          // fs.rmdirSync with "recursive: true" flag doesn't do the job properly...
          fs.readdirSync(tmp.tmpdir).forEach(function (fileOrDir) {
            // snapshot zip files
            deleteFileOrDirIfMatches(
              fileOrDir,
              snapshotMatchRegex,
              deleteSnapshotBeforeDateTime
            );

            // snapshot zip tmp dir
            // fix for back-words compatibility, to remove old directories, that weren't deleted on time when zip was created
            deleteFileOrDirIfMatches(
              fileOrDir,
              snapshotTmpDirMatchRegex,
              deleteSnapshotBeforeDateTime
            );

            // uploaded files & directories
            deleteFileOrDirIfMatches(
              fileOrDir,
              uploadedMatchRegex,
              deleteTmpUploadBeforeDateTime
            );

            // uploaded import files
            deleteFileOrDirIfMatches(
              fileOrDir,
              uploadedImportMatchRegex,
              deleteTmpUploadImportBeforeDateTime
            );
          });
        }
      } catch (remErr) {
        // we don't have rights to delete files or something has gone wrong...
        // log data and continue as God intended to be..without any worries...
        app.logger.error(`Failed removing tmp snapshot files: ${remErr}`);
      }

      // finished
      done();
    },

    // delete audit logs older than n days
    (done) => {
      try {
        // check if we need to delete
        const removeAuditLogsOlderThanNDays = _.get(configSettings, 'removeAuditLogsOlderThanNDays', 180);

        // check if we need to remove older audit logs
        if (
          deleteAuditLogInProgress ||
          !removeAuditLogsOlderThanNDays ||
          typeof removeAuditLogsOlderThanNDays !== 'number' ||
          removeAuditLogsOlderThanNDays < 1
        ) {
          return done();
        }

        // start delete audit logs
        deleteAuditLogInProgress = true;

        // must remove older audit logs
        const beforeDate = localizationHelper.now().subtract(removeAuditLogsOlderThanNDays, 'days');
        app.models.auditLog
          .rawBulkHardDelete({
            createdAt: {
              $lte: beforeDate.toISOString()
            }
          })
          .then((deleteResult) => {
            // log
            if (
              deleteResult.result &&
              deleteResult.result.n > 0
            ) {
              app.logger.info(`Removed ${deleteResult.result.n} audit logs older than '${beforeDate.toISOString()}'`);
            }

            // finished delete audit logs
            deleteAuditLogInProgress = false;
          })
          .catch((deleteErr) => {
            // something went wrong...
            app.logger.error(`Failed executing audit logs deletion older than '${configSettings.removeAuditLogsOlderThanNDays}' days: ${deleteErr}`);

            // finished delete audit logs
            deleteAuditLogInProgress = false;
          });
      } catch (cleanErr) {
        // finished delete audit logs
        deleteAuditLogInProgress = false;

        // something went wrong...
        app.logger.error(`Failed removing audit logs older than '${configSettings.removeAuditLogsOlderThanNDays}' days: ${cleanErr}`);
      }

      // finished
      done();
    }
  ];

  // endless loop, running every 5 minutes
  setInterval(() => {
    try {
      // retrieve file content
      const fileContent = fs.readFileSync(routinesConfigFilePath);

      // failed to parse JSON content ?
      try {
        routinesConfig = JSON.parse(fileContent);
      } catch (err) {
        // not ideal but must clean file, otherwise nothing will work anymore
        routinesConfig = {};
        fs.writeFileSync(routinesConfigFilePath, JSON.stringify(routinesConfig));

        // send error further
        throw err;
      }

      // run the configured routines
      async.parallel(
        routines,
        () => {
          // write the routines config back to file
          // to make sure any changes are persistent from tick to tick
          try {
            fs.writeFileSync(routinesConfigFilePath, JSON.stringify(routinesConfig));
          } catch (writeErr) {
            app.logger.warn(`Failed to write routines configuration ('${routinesConfigFilePath}'). ${writeErr}`);
          }
        }
      );
    } catch (readErr) {
      app.logger.error(`Failed to read routines configuration ('${routinesConfigFilePath}'). ${readErr}`);
    }
  }, 300000);
};
