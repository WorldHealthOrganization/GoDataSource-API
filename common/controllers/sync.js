'use strict';

const fs = require('fs');
const formidable = require('formidable');
const app = require('../../server/server');
const dbSync = require('../../components/dbSync');
const _ = require('lodash');
const moment = require('moment');

module.exports = function (Sync) {

  /**
   * Get encrypt/decrypt password for sync process
   * @param password
   * @param clientCredentials
   * @return {*}
   */
  function getSyncEncryptPassword(password, clientCredentials) {
    // if a password was not provided, but client credentials were
    if (password == null && clientCredentials) {
      // build the password by concatenating clientId and clientSecret
      password = clientCredentials.clientId + clientCredentials.clientSecret;
    }
    // if a password is present
    if (password) {
      // hash it
      password = app.utils.helpers.sha256(password);
    }
    return password;
  }

  /**
   * Get Database Snapshot in sync/async mode
   * @param filter
   * @param asynchronous
   * @param password Encryption password
   * @param options
   * @param done
   * @returns {*}
   */
  function getDatabaseSnapshot(filter, asynchronous, password, options, done) {
    /**
     * Update export log entry and offer file for download if needed
     * @param err
     * @param fileName
     * @param exportLogEntry
     * @param options
     * @param done
     */
    function exportCallback(err, fileName, exportLogEntry, options, done) {
      // update exportLogEntry
      exportLogEntry.actionCompletionDate = new Date();

      if (err) {
        app.logger.debug(`Export ${exportLogEntry.id}: Error ${err}`);
        exportLogEntry.status = 'LNG_SYNC_STATUS_FAILED';
        exportLogEntry.error = err.toString ? err.toString() : err;
      } else {
        app.logger.debug(`Export ${exportLogEntry.id}: Success`);
        exportLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS';
        exportLogEntry.location = fileName;
      }

      // save sync log entry
      exportLogEntry
        .save(options)
        .then(function () {
          // nothing to do; sync log entry was saved
          app.logger.debug(`Export ${exportLogEntry.id}: Updated export log entry status.`);
        })
        .catch(function (err) {
          app.logger.debug(`Export ${exportLogEntry.id}: Error updating export log entry status. ${err}`);
        });

      // check if a callback function was received; In that case we need to return the file
      if (done) {
        if (err) {
          return done(err);
        }
        return app.utils.remote.helpers.offerFileToDownload(fs.createReadStream(fileName), 'application/octet-stream', fileName, done);
      }
    }

    // get asynchronous flag value; default: false
    asynchronous = asynchronous || false;

    filter = filter || {};
    filter.where = filter.where || {};

    // check for received outbreakIDs in filter
    let outbreakIDFilter = _.get(filter, 'where.outbreakId');
    // get allowed outbreaks IDs for the client
    let allowedOutbreakIDs = _.get(options, 'remotingContext.req.authData.client.outbreakIDs', []);
    // initialize list of IDs for the outbreaks that will be exported
    let exportedOutbreakIDs = [];

    // the outbreakID filter is accepted as an {inq: ['outbreak ID']} filter of a string value
    if (outbreakIDFilter) {
      let requestOutbreakIDs = [];
      if (typeof outbreakIDFilter === 'object' && outbreakIDFilter !== null && Array.isArray(outbreakIDFilter.inq)) {
        requestOutbreakIDs = outbreakIDFilter.inq;
      } else if (typeof outbreakIDFilter === 'string') {
        requestOutbreakIDs = [outbreakIDFilter];
      }

      if (requestOutbreakIDs.length) {
        // check if all the requested outbreak IDs are allowed
        // if the allowedOutbreakIDs is an empty array all the outbreakIDs are allowed
        if (!allowedOutbreakIDs.length) {
          // nothing to do; will use the received outbreakIDs from the filter
        } else {
          let disallowedOutbreakIDs = requestOutbreakIDs.filter(outbreakID => allowedOutbreakIDs.indexOf(outbreakID) === -1);
          if (disallowedOutbreakIDs.length) {
            // some disallowed outbreak IDs were requested; return error
            return done(app.utils.apiError.getError('ACCESS_DENIED', {
              accessErrors: `Client is not allowed to access the following outbreaks: ${disallowedOutbreakIDs.join(', ')}`
            }, 403));
          }
        }

        // outbreaks that will be filtered are the ones from the received filter; no need to changes the filter
        exportedOutbreakIDs = requestOutbreakIDs;
      } else {
        // an empty outbreakId filter was sent; nothing to do here, will use the client allowed outbreakIDs
      }
    }

    // set the client allowed outbreakIDs in the filter if the received outbreakId filter was empty/invalid
    if (!exportedOutbreakIDs.length && allowedOutbreakIDs.length) {
      // outbreakId filter was not sent or is in an invalid format
      // use the allowedOutbreakIDs as filter
      filter.where.outbreakId = {
        inq: allowedOutbreakIDs
      };

      // keep exportedOutbreakIDs data
      exportedOutbreakIDs = allowedOutbreakIDs;
    }

    // create list of exported collections depending on different filters
    let collections;

    // get exportType filter
    let exportTypeFilter = _.get(filter, 'where.exportType');
    if (Object.keys(dbSync.collectionsForExportTypeMap).indexOf(exportTypeFilter) !== -1) {
      // sent exportType is valid; export assigned collections
      // in this case the collections filter is ignored
      collections = dbSync.collectionsForExportTypeMap[exportTypeFilter];
    } else {
      // check for collections filter
      let collectionsFilter = _.get(filter, 'where.collections');
      if (Array.isArray(collectionsFilter)) {
        // export the received collections
        collections = collectionsFilter;
      } else {
        // use mobile exportType collections by default
        collections = dbSync.collectionsForExportTypeMap.mobile;
      }
    }

    // get includeUsers filter to check if the user collections need to be exported
    let includeUsersFilter = _.get(filter, 'where.includeUsers');
    if (includeUsersFilter) {
      collections = collections.concat(dbSync.userCollections);
    }

    // create export log entry
    app.models.databaseExportLog
      .create({
        syncClientId: _.get(options, 'remotingContext.req.authData.client.credentials.clientId', `webUser: ${_.get(options, 'remotingContext.req.authData.user.id', 'unavailable')}`),
        actionStartDate: new Date(),
        status: 'LNG_SYNC_STATUS_IN_PROGRESS',
        outbreakIDs: exportedOutbreakIDs
      }, options)
      .then(function (exportLogEntry) {
        if (!asynchronous) {
          Sync.exportDatabase(
            filter,
            collections,
            // no collection specific options
            [],
            {password: password},
            (err, fileName) => {
              // send the done function as the response needs to be returned
              exportCallback(err, fileName, exportLogEntry, options, done);
            });
        } else {
          // export is done asynchronous
          // send response; don't wait for export
          done(null, exportLogEntry.id);

          // export the DB
          Sync.exportDatabase(
            filter,
            collections,
            // no collection specific options
            [],
            {password: password},
            (err, fileName) => {
              // don't send the done function as the response was already sent
              exportCallback(err, fileName, exportLogEntry, options);
            });
        }
      })
      .catch(done);
  }

  /**
   * Retrieve a compressed snapshot of the database
   * Supported filters:
   * fromDate: Date
   * outbreakId: 'outbreak ID' / {inq: ['outbreak ID1', 'outbreak ID2']}
   * collections: ['modelName']
   * exportType: enum [mobile, system, outbreak, full]
   * includeUsers: boolean
   * Eg filter: {"where": {"fromDate": "dateString", "outbreakId": "outbreak ID", "collections": ["person", "outbreak", ...], "exportType": "mobile", "includeUsers": true}}
   * Note: when exportType is present 'collections' is ignored. If both collections and exportType are not present default 'mobile' export type is used
   * @param filter
   * @param password Encryption password
   * @param options Options from request
   * @param done
   */
  Sync.getDatabaseSnapshot = function (filter, password, options, done) {
    getDatabaseSnapshot(filter, false, getSyncEncryptPassword(password, _.get(options, 'remotingContext.req.authData.credentials')), options, done);
  };

  /**
   * Export a compressed snapshot of the database. Return an exportLogEntry ID
   * This action is used for asynchronous processes
   * Supported filters:
   * fromDate: Date
   * outbreakId: 'outbreak ID' / {inq: ['outbreak ID1', 'outbreak ID2']}
   * collections: ['modelName']
   * exportType: enum [mobile, system, outbreak, full]
   * includeUsers: boolean
   * Eg filter: {"where": {"fromDate": "dateString", "outbreakId": "outbreak ID", "collections": ["person", "outbreak", ...], "exportType": "mobile", "includeUsers": true}}
   * Note: when exportType is present 'collections' is ignored. If both collections and exportType are not present default 'mobile' export type is used
   * @param filter
   * @param password Encryption password
   * @param options Options from request
   * @param done
   */
  Sync.getDatabaseSnapshotAsynchronous = function (filter, password, options, done) {
    getDatabaseSnapshot(filter, true, getSyncEncryptPassword(password, _.get(options, 'remotingContext.req.authData.credentials')), options, done);
  };

  /**
   * Download an already exported snapshot of the database
   * @param databaseExportLogId Database Export log ID
   * @param options Options from request
   * @param done
   */
  Sync.getExportedDatabaseSnapshot = function (databaseExportLogId, options, done) {
    // get export log entry
    app.models.databaseExportLog
      .findById(databaseExportLogId)
      .then(function (exportLogEntry) {
        if (!exportLogEntry) {
          return done(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.databaseExportLog.modelName,
            id: databaseExportLogId
          }));
        }

        // check export log status and location
        if (exportLogEntry.status === 'LNG_SYNC_STATUS_IN_PROGRESS') {
          return done(app.utils.apiError.getError('INSTANCE_EXPORT_STILL_IN_PROGRESS'));
        } else if (exportLogEntry.status === 'LNG_SYNC_STATUS_FAILED') {
          return done(app.utils.apiError.getError('INSTANCE_EXPORT_FAILED', {
            error: exportLogEntry.error
          }));
        }

        // exportLogEntry status is success; check for location and file
        if (!exportLogEntry.location || !fs.existsSync(exportLogEntry.location)) {
          // fail the exportLogEntry
          exportLogEntry
            .updateAttributes({
              status: 'LNG_SYNC_STATUS_FAILED',
              error: 'Export location is missing or file cannot be found'
            })
            .then(() => {
              // nothing to do
              app.logger.debug(`Export ${exportLogEntry.id}: Updated DB export log entry status`);
            })
            .catch((err) => {
              app.logger.debug(`Export ${exportLogEntry.id}: Failed to save DB export log entry: Error ${err}`);
            });

          return done(app.utils.apiError.getError('INSTANCE_EXPORT_FAILED', {
            error: exportLogEntry.error
          }));
        }

        // download file
        return app.utils.remote.helpers.offerFileToDownload(fs.createReadStream(exportLogEntry.location), 'application/octet-stream', exportLogEntry.location, done);
      })
      .catch(done);
  };

  /**
   * Synchronize database based on a given snapshot archive containing matching collections
   * @param req
   * @param snapshot Database snapshot .tar.gz archive
   * @param asynchronous Flag to specify whether the import is sync or async. Default: sync (false)
   * @param triggerBackupBeforeSync Flag to specify whether before the import a backup should be triggered. If the flag is not sent the System settings triggerBackupBeforeSync flag will be used
   * @param done
   */
  Sync.importDatabaseSnapshot = function (req, snapshot, asynchronous, triggerBackupBeforeSync, done) {
    const buildError = app.utils.apiError.getError;

    /**
     * Import action callback; Depending on the asynchronous it can be called with/without the callback
     * @param err
     * @param syncLogEntry
     * @param requestOptions
     * @param callback
     */
    function importCallback(err, syncLogEntry, requestOptions, callback) {
      // update syncLogEntry
      syncLogEntry.actionCompletionDate = new Date();

      if (err) {
        app.logger.debug(`Sync ${syncLogEntry.id}: Error ${err}`);
        syncLogEntry.status = err.errorType === Sync.errorType.fatal ? 'LNG_SYNC_STATUS_FAILED' : 'LNG_SYNC_STATUS_SUCCESS_WITH_WARNINGS';
        let errorMessage = err.errorMessage;
        syncLogEntry.error = errorMessage.toString ? errorMessage.toString() : errorMessage;
      } else {
        app.logger.debug(`Sync ${syncLogEntry.id}: Success`);
        syncLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS';
      }

      // save sync log entry
      syncLogEntry
        .save(requestOptions)
        .then(function () {
          // nothing to do; sync log entry was saved
          app.logger.debug(`Sync ${syncLogEntry.id}: Updated sync log entry status`);
        })
        .catch(function (err) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
        });

      // execute callback if received
      if (callback) {
        // if an error was encountered
        if (err) {
          // rewrite toString to something useful
          err.toString = function () {
            return JSON.stringify(this);
          };
          // rewrite error with API error
          err = buildError('INSTANCE_SYNC_FAILED', {
            syncError: err
          });
        }
        return callback(err, syncLogEntry.id);
      }
    }

    const form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
      if (err) {
        return done(err);
      }

      // validates snapshot archive
      if (!files.snapshot) {
        // send back the error
        return done(buildError('MISSING_REQUIRED_PROPERTY', {
          model: Sync.modelName,
          properties: 'snapshot'
        }));
      }

      // get asynchronous flag value
      asynchronous = fields.asynchronous && fields.asynchronous === 'true';

      // get request options
      let requestOptions = {
        remotingContext: {
          req: req
        }
      };

      // get outbreaks IDs for client
      let outbreakIDs = _.get(req, 'authData.client.outbreakIDs');
      if (!Array.isArray(outbreakIDs)) {
        outbreakIDs = [];
      }

      // get password
      const password = getSyncEncryptPassword(fields.password, _.get(requestOptions, 'remotingContext.req.authData.credentials'));

      // create sync log entry
      app.models.syncLog
        .create({
          syncClientId: _.get(req, 'authData.client.credentials.clientId', `webUser: ${_.get(req, 'authData.user.id', 'unavailable')}`),
          actionStartDate: new Date(),
          status: 'LNG_SYNC_STATUS_IN_PROGRESS',
          outbreakIDs: outbreakIDs
        }, requestOptions)
        .then(function (syncLogEntry) {
          if (!asynchronous) {
            // extract the archive to the temporary directory
            Sync.syncDatabaseWithSnapshot(
              files.snapshot.path,
              syncLogEntry,
              outbreakIDs,
              requestOptions,
              triggerBackupBeforeSync,
              {password: password},
              function (err) {
                // send done function to return the response
                importCallback(err, syncLogEntry, requestOptions, done);
              });
          } else {
            // import is done asynchronous
            // send response; don't wait for import
            done(null, syncLogEntry.id);

            // extract the archive to the temporary directory
            Sync.syncDatabaseWithSnapshot(
              files.snapshot.path,
              syncLogEntry,
              outbreakIDs,
              requestOptions,
              triggerBackupBeforeSync,
              {password: password},
              function (err) {
                // don't send the done function as the response was already sent
                importCallback(err, syncLogEntry, requestOptions);
              });
          }
        })
        .catch(done);
    });
  };

  /**
   * Retrieve the list of IDs for the client available outbreaks
   * @param options
   * @param callback
   */
  Sync.getAvailableOutbreaksForClient = function (options, callback) {
    let clientInformation = options.remotingContext.req.authData.client;
    callback(null, {
      outbreakIDs: clientInformation.outbreakIDs || []
    });
  };

  /**
   * Start sync process with a received upstream server
   * @param data,
   * @param options
   * @param callback
   */
  Sync.sync = function (data, options, callback) {
    // validate data; check for required upstreamServerURL property in req body
    if (!data.upstreamServerURL || typeof data.upstreamServerURL !== 'string') {
      return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
        errorMessages: 'Missing required property "upstreamServerURL"'
      }));
    }

    // initialize flag to know if the callback function was already called
    // need to do this as we will call it and then continue doing some actions
    let callbackCalled = false;

    // initialize upstreamServer options container
    let upstreamServerEntry;

    // initialize variable for caching the syncLogEntry
    let syncLogEntry;

    // initialize variable for caching the system settings
    let systemSettings;

    // check if the received upstream server URL matches one from the configured upstream servers
    app.models.systemSettings
      .getCache()
      .then(function (record) {
        // initialize error
        if (!record) {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: 'System Settings were not found'
          });
        }

        // cache system settings
        systemSettings = record;

        // find the upstream server entry that matches the received url
        if (!Array.isArray(systemSettings.upstreamServers) || !(upstreamServerEntry = systemSettings.upstreamServers.find(serverEntry => serverEntry.url === data.upstreamServerURL))) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_NOT_CONFIGURED', {
            upstreamServerURL: data.upstreamServerURL
          });
        }

        // upstream server was found; check if sync is enabled
        if (!upstreamServerEntry.syncEnabled) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_DISABLED', {
            upstreamServerName: upstreamServerEntry.name,
            upstreamServerURL: upstreamServerEntry.url
          });
        }

        // check if there is a sync in progress to the same server and the sync is not forced
        // sync is forced by the sync on every change functionality
        if (Sync.inProgress.servers[upstreamServerEntry.url] && !data.forceSync) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_IN_PROGRESS', {
            upstreamServerName: upstreamServerEntry.name,
            upstreamServerURL: upstreamServerEntry.url
          });
        }

        // start sync with upstream server
        // create syncLog entry in the DB
        return app.models.syncLog.create({
          syncServerUrl: upstreamServerEntry.url,
          actionStartDate: new Date(),
          status: 'LNG_SYNC_STATUS_IN_PROGRESS'
        }, options);
      })
      .then(function (syncLog) {
        // cache sync log entry as it will need to be updated with different statuses
        syncLogEntry = syncLog;

        // update Sync.inProgress map; Sync action is in progress
        Sync.inProgress.servers[upstreamServerEntry.url] = true;

        // send response with the syncLogEntry ID
        // the sync action continues after the response is sent with the syncLogEntry being updated when the sync fails/succeeds
        callback(null, syncLogEntry.id);
        callbackCalled = true;

        app.logger.debug(`Started sync ${syncLogEntry.id}`);

        // continue sync
        // get available outbreakIDs for the client
        return Sync.getAvailableOutbreaksIDs(upstreamServerEntry, syncLogEntry);
      })
      .then(function (outbreakIDs) {
        app.logger.debug(`Sync ${syncLogEntry.id}: Sync will be done for ${outbreakIDs.length ? ('the following outbreaks: ' + outbreakIDs.join(', ')) : 'all the outbreaks in the system'}`);
        // save retrieve outbreak IDs on the sync log entry
        syncLogEntry.outbreakIDs = outbreakIDs;

        // check if the outbreaks with the given IDs were ever successfully synced with the upstream server
        // we will only sync daca updated from the last sync
        return app.models.syncLog
          .findOne({
            where: {
              syncServerUrl: upstreamServerEntry.url,
              status: 'LNG_SYNC_STATUS_SUCCESS'
            },
            order: 'actionStartDate DESC'
          })
          .then(function (lastSyncLogEntry) {
            if (!lastSyncLogEntry) {
              // there was no sync done with the upstream server; will sync all data from the DB
              app.logger.debug(`Sync ${syncLogEntry.id}: No successful sync was found for the upstream server with URL '${upstreamServerEntry.url}'. Syncing all data from the DB.`);
            } else {
              // get date from which we will sync the data
              // in order to prevent data loss from the moment where the sync was started to the moment when the actionStartDate was set, get data from 1 minute earlier
              let syncDate = moment(lastSyncLogEntry.actionStartDate).subtract(1, 'minutes');
              syncLogEntry.informationStartDate = syncDate;
              app.logger.debug(`Sync ${syncLogEntry.id}: Latest successful sync with the upstream server (${upstreamServerEntry.url}) was done on '${new Date(syncLogEntry.informationStartDate).toISOString()}'. Syncing data from that date onwards`);
            }

            // save added details in the sync log entry
            return syncLogEntry.save(options);
          });
      })
      .then(function () {
        // gathered all required data for starting the sync
        // Sync steps:
        // 1: export local DB
        // 2: send DB to be synced on the upstream server

        // export local DB
        // initialize filter and update it if needed
        let filter = {
          where: {}
        };
        // get data from date
        if (syncLogEntry.informationStartDate) {
          filter.where.fromDate = syncLogEntry.informationStartDate;
        }
        // get data from the required outbreaks
        if (Array.isArray(syncLogEntry.outbreakIDs) && syncLogEntry.outbreakIDs.length) {
          filter.where.outbreakId = {
            inq: syncLogEntry.outbreakIDs
          };
        }

        // 1: export local DB
        // export the sync collections
        let collections = dbSync.syncCollections;

        // get password
        const password = getSyncEncryptPassword(null, upstreamServerEntry.credentials);

        app.logger.debug(`Sync ${syncLogEntry.id}: Exporting DB.`);
        return new Promise(function (resolve, reject) {
          Sync.exportDatabase(
            filter,
            collections,
            // no collection specific options
            [],
            {password: password},
            (err, fileName) => {
              if (err) {
                return reject(err);
              }
              app.logger.debug(`Sync ${syncLogEntry.id}: DB exported at ${fileName}.`);
              return resolve(fileName);
            });
        });
      })
      .then(function (exportedDBFileName) {
        // 2: send DB to be synced on the upstream server
        return Sync.sendDBSnapshotForImport(upstreamServerEntry, exportedDBFileName, true, syncLogEntry);
      })
      .then(function () {
        // sync was successful
        // update syncLogEntry
        syncLogEntry.actionCompletionDate = new Date();

        // check for partial success
        if (syncLogEntry.error) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Success with warnings; ${syncLogEntry.error}`);
          syncLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS_WITH_WARNINGS';
        }
        else {
          // success
          app.logger.debug(`Sync ${syncLogEntry.id}: Success`);
          syncLogEntry.status = 'LNG_SYNC_STATUS_SUCCESS';
        }

        // save sync log entry
        syncLogEntry
          .save(options)
          .then(function () {
            // nothing to do; sync log entry was saved
            app.logger.debug(`Sync ${syncLogEntry.id}: Updated sync log entry status.`);
          })
          .catch(function (err) {
            app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
          });

        // update Sync.inProgress map; Sync action just finished
        Sync.inProgress.servers[upstreamServerEntry.url] = false;
        // check for pending sync for the server and trigger it
        Sync.checkAndTriggerPendingSync(upstreamServerEntry, options);
      })
      .catch(function (err) {
        if (!callbackCalled) {
          // sync wasn't started; the error response is sent directly in the response
          callback(err);
          callbackCalled = true;
        } else {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error ${err}`);
          // update sync log status
          syncLogEntry.actionCompletionDate = new Date();
          syncLogEntry.status = 'LNG_SYNC_STATUS_FAILED';
          syncLogEntry.addError(err.toString ? err.toString() : err);
          syncLogEntry
            .save(options)
            .then(function () {
              // nothing to do; sync log entry was saved
              app.logger.debug(`Sync ${syncLogEntry.id}: Updated sync log entry status.`);
            })
            .catch(function (err) {
              app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
            });

          // update Sync.inProgress map; Sync action just finished
          Sync.inProgress.servers[upstreamServerEntry.url] = false;
          // check for pending sync for the server and trigger it
          Sync.checkAndTriggerPendingSync(upstreamServerEntry, options);
        }
      });
  };
};
