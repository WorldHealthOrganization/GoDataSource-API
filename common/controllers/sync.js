'use strict';

const fs = require('fs');
const formidable = require('formidable');
const app = require('../../server/server');
const dbSync = require('../../components/dbSync');

module.exports = function (Sync) {
  /**
   * Retrieve a compressed snapshot of the database
   * Date filter is supported ({ fromDate: Date })
   * @param filter
   * @param done
   */
  Sync.getDatabaseSnapshot = function (filter, done) {
    filter = filter || {};
    filter.where = filter.where || {};

    // for mobile list of collections that are exported is restricted
    let collections = Object.keys(dbSync.collectionsMap);
    if (filter.mobile) {
      let excludedCollections = [
        'systemSettings',
        'template',
        'icon',
        'helpCategory'
      ];
      collections = collections.filter((collection) => excludedCollections.indexOf(collection) === -1);
    }

    Sync.exportDatabase(
      filter,
      collections,
      // no collection specific options
      [],
      (err, fileName) => {
        if (err) {
          return done(err);
        }
        return done(null, fs.createReadStream(fileName), 'application/octet-stream');
      });
  };

  /**
   * Synchronize database based on a given snapshot archive containing matching collections
   * @param req
   * @param snapshot Database snapshot .tar.gz archive
   * @param asynchronous Flag to specify whether the import is sync or async. Default: sync (false)
   * @param done
   */
  Sync.importDatabaseSnapshot = function (req, snapshot, asynchronous, done) {
    /**
     * Import action callback; Depending on the asynchronous it can be called with/without the callback
     * @param err
     * @param result
     * @param syncLogEntry
     * @param requestOptions
     * @param callback
     */
    function importCallback(err, result, syncLogEntry, requestOptions, callback) {
      // update syncLogEntry
      syncLogEntry.syncProcessCompletionDate = new Date();

      if (err) {
        app.logger.debug(`Sync ${syncLogEntry.id}: Error ${err}`);
        syncLogEntry.syncStatus = 'LNG_SYNC_STATUS_FAILED';
        syncLogEntry.failReason = err.toString ? err.toString() : err;
      } else {
        app.logger.debug(`Sync ${syncLogEntry.id}: Success`);
        syncLogEntry.syncStatus = 'LNG_SYNC_STATUS_SUCCESS';
      }

      // check for failedRecords in the result
      if (result && result.failedRecords) {
        // log the failed records
        app.logger.debug(`Sync ${syncLogEntry.id}: Sync succeeded with some failed records`);
        Object.keys(result.failedRecords).forEach(function (collectionName) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Failed Records in '${collectionName}' collection: ${result.failedRecords[collectionName].join(', ')}`);
        });
      }

      // save sync log entry
      syncLogEntry
        .save(requestOptions)
        .then(function () {
          // nothing to do; sync log entry was saved
        })
        .catch(function (err) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
        });

      // call callback if received; don't wait for sync log entry to be updated
      callback && callback(err, syncLogEntry.id);
    }

    const buildError = app.utils.apiError.getError;
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
      asynchronous = fields.asynchronous && fields.asynchronous === 'true' ? true : false;

      // get request options
      let requestOptions = {
        remotingContext: {
          req: req
        }
      };

      // get outbreaks IDs for client
      let outbreakIDs = req.authData.client.outbreakIDs;
      if (!Array.isArray(outbreakIDs)) {
        outbreakIDs = [];
      }

      // create sync log entry
      app.models.syncLog
        .create({
          syncClientId: req.authData.client.credentials.clientId,
          syncProcessStartDate: new Date(),
          syncStatus: 'LNG_SYNC_STATUS_IN_PROGRESS',
          syncOutbreakIDs: outbreakIDs
        }, requestOptions)
        .then(function (syncLogEntry) {
          if (!asynchronous) {
            // extract the archive to the temporary directory
            Sync.syncDatabaseWithSnapshot(files.snapshot.path, syncLogEntry, outbreakIDs, requestOptions, function (err, result) {
              // send done function to return the response
              importCallback(err, result, syncLogEntry, requestOptions, done);
            });
          } else {
            // import is done asynchronous
            // send response; don't wait for import
            done(null, syncLogEntry.id);

            // extract the archive to the temporary directory
            Sync.syncDatabaseWithSnapshot(files.snapshot.path, syncLogEntry, outbreakIDs, requestOptions, function (err, result) {
              // don't send the done function as the response was already sent
              importCallback(err, result, syncLogEntry, requestOptions);
            });
          }
        })
        .catch(done);
    });
  };

  /**
   * Retrieve the list of IDs for the client available outbreaks
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

    // check if the received upstream server URL matches one from the configured upstream servers
    app.models.systemSettings
      .findOne()
      .then(function (systemSettings) {
        // initialize error
        if (!systemSettings) {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: 'System Settings were not found'
          });
        }

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

        // start sync with upstream server
        // create syncLog entry in the DB
        return app.models.syncLog.create({
          syncServerUrl: upstreamServerEntry.url,
          syncProcessStartDate: new Date(),
          syncStatus: 'LNG_SYNC_STATUS_IN_PROGRESS'
        }, options);
      })
      .then(function (syncLog) {
        // cache sync log entry as it will need to be updated with different statuses
        syncLogEntry = syncLog;

        // send response with the syncLogEntry ID
        callback(null, syncLogEntry.id);
        callbackCalled = true;

        app.logger.debug(`Started sync ${syncLogEntry.id}`);

        // continue sync
        // get available outbreakIDs for the client
        return Sync.getAvailableOutbreaksIDs(upstreamServerEntry);
      })
      .then(function (outbreakIDs) {
        app.logger.debug(`Sync ${syncLogEntry.id}: Sync will be done for ${outbreakIDs.length ? ('the following outbreaks: ' + outbreakIDs.join(', ')) : 'all the outbreaks in the system'}`);
        // save retrieve outbreak IDs on the sync log entry
        syncLogEntry.syncOutbreakIDs = outbreakIDs;

        // check if the outbreaks with the given IDs were ever successfully synced with the upstream server
        // we will only sync daca updated from the last sync
        return app.models.syncLog
          .findOne({
            where: {
              syncServerUrl: upstreamServerEntry.url,
              syncStatus: 'LNG_SYNC_STATUS_SUCCESS'
            },
            order: 'syncProcessStartDate DESC'
          })
          .then(function (lastSyncLogEntry) {
            if (!lastSyncLogEntry) {
              // there was no sync done with the upstream server; will sync all data from the DB
              app.logger.debug(`Sync ${syncLogEntry.id}: No sync log was found for the upstream server with URL '${upstreamServerEntry.url}'. Syncing all data from the DB.`);
            } else {
              // get date from which we will sync the data
              syncLogEntry.syncInformationStartDate = lastSyncLogEntry.syncProcessStartDate;
              app.logger.debug(`Sync ${syncLogEntry.id}: Latest sync with the upstream server (${upstreamServerEntry.url}) was done on '${new Date(syncLogEntry.syncInformationStartDate).toISOString()}'. Syncing data from that date onwards`);
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
        // 3: get DB from the upstream server
        // 4. import the received DB

        // export local DB
        // initialize filter and update it if needed
        let filter = {
          where: {}
        };
        // get data from date
        if (syncLogEntry.syncInformationStartDate) {
          filter.where.fromDate = syncLogEntry.syncInformationStartDate;
        }
        // get data from the required outbreaks
        if (Array.isArray(syncLogEntry.syncOutbreakIDs) && syncLogEntry.syncOutbreakIDs.length) {
          filter.where.outbreakId = {
            inq: syncLogEntry.syncOutbreakIDs
          };
        }

        // 1: export local DB
        app.logger.debug(`Sync ${syncLogEntry.id}: Exporting DB.`);
        return new Promise(function (resolve, reject) {
          Sync.exportDatabase(
            filter,
            // excluding the following models for sync
            [
              'systemSettings',
              'team',
              'user',
              'role'
            ],
            // no collection specific options
            [],
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
        // get available outbreakIDs for the client
        return Sync.sendDBSnapshotForImport(upstreamServerEntry, exportedDBFileName);
      })
      .then(function (serverSyncLogEntryId) {
        let x = 2;
      })
      .catch(function (err) {
        if (!callbackCalled) {
          callback(err);
          callbackCalled = true;
        } else {
          app.logger.debug(`Sync ${syncLogEntry.id}: Error ${err}`);
          // update sync log status
          syncLogEntry.syncStatus = 'LNG_SYNC_STATUS_FAILED';
          syncLogEntry.failReason = err.toString ? err.toString() : err;
          syncLogEntry
            .save(options)
            .then(function () {
              // nothing to do; sync log entry was saved
            })
            .catch(function (err) {
              app.logger.debug(`Sync ${syncLogEntry.id}: Error updating sync log entry status. ${err}`);
            });
        }
      });
  };
};
