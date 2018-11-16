'use strict';

// requires
const tmp = require('tmp');
const async = require('async');
const app = require('../../server/server');
const fs = require('fs');
const dbSync = require('../../components/dbSync');
const AdmZip = require('adm-zip');
const SyncClient = require('../../components/syncClient');
const syncConfig = require('../../server/config.json').sync;
const asyncActionsSettings = syncConfig.asyncActionsSettings;
const _ = require('lodash');
const Moment = require('moment');

module.exports = function (Sync) {
  Sync.hasController = true;

  // We won't allow a client to sync to the same server twice at the same time
  // Keeping in progress sync maps for upstream servers
  Sync.inProgress = {
    servers: {}
  };

  // For sync on every change we will keep a sync action in pending state is there is another sync in progress
  // Keeping pending sync maps for upstream servers
  Sync.pending = {
    servers: {}
  };

  // Initialize sync error type map;
  Sync.errorType = {
    fatal: 'Fatal', // sync action could not be started
    partial: 'Partial' // sync action completed but some records failed
  };

  // Create functions for getting error depending on type
  /**
   * Get sync error
   * @param errorType
   * @param error
   * @returns {{errorType: *, errorMessage: *}}
   */
  function getSyncError(errorType, error) {
    return {
      errorType: errorType,
      errorMessage: error
    };
  }

  /**
   * Get a fatal error
   * Note: Error message must be an object containing at least 'message' property
   * @param error
   * @returns {{errorType, errorMessage: { message: string }}}
   */
  Sync.getFatalError = function (error) {
    return getSyncError(Sync.errorType.fatal, error);
  };

  /**
   * Get a partial error
   * Note: Error message must be an object containing at least 'message' property
   * @param error
   * @returns {{errorType, errorMessage: { message: string }}}
   */
  Sync.getPartialError = function (error) {
    return getSyncError(Sync.errorType.partial, error);
  };

  /**
   * Helper function used to export the database's collections
   * The following extra features are available:
   * - exclude some collections
   * - collection specific options:
   *   - encrypt the file
   *   - exclude some properties
   * - custom filter { fromDate: Date } to only retrieve records past a given date
   * @param filter
   * @param collections
   * @param collectionsOpts
   * @param options {{password: '<encryptPassword>'}}
   * @param done
   */
  Sync.exportDatabase = function (filter, collections, collectionsOpts, options, done) {
    // defensive checks
    options = options || {};
    filter = filter || {where: {}};
    collections = collections || [];
    collectionsOpts = collectionsOpts || [];
    collectionsOpts.map((collectionOpts) => {
      collectionOpts.excludes = collectionOpts.excludes || [];
      collectionOpts.shouldEncrypt = collectionOpts.shouldEncrypt || false;
    });

    // cache reference to mongodb connection
    let connection = app.dataSources.mongoDb.connector;

    // parse from date filter
    let customFilter = null;
    if (filter.where.hasOwnProperty('fromDate')) {
      // doing this because createdAt and updatedAt are equal when a record is created
      customFilter = {
        updatedAt: {
          $gte: new Date(filter.where.fromDate)
        }
      };
    }

    // create a copy of the collections map and keep only the ones from the collection list given
    // if passed collection is empty, continue with all the collections
    let allCollections = Object.assign({}, dbSync.collectionsMap);
    if (collections.length) {
      Object.keys(allCollections).forEach((collectionName) => {
        if (collections.indexOf(collectionName) === -1) {
          delete allCollections[collectionName];
        }
      });
    }

    // create a temporary directory to store the database files
    // it always created the folder in the system temporary directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;

    return async
      .series(
        Object.keys(allCollections).map((collectionName) => {
          return (callback) => {
            // look up for any specific options
            let collectionOpts = collectionsOpts.filter((item) => item.name === collectionName)[0];

            // check if properties should be excluded
            let excludes = {};

            if (collectionOpts && collectionOpts.excludes.length) {
              Object.keys(collectionOpts.excludes).forEach((prop) => {
                excludes[prop] = 0;
              });
            }

            // get mongoDB filter that will be sent; for some collections we might send additional filters
            let mongoDBFilter = dbSync.collectionsFilterMap[collectionName] ? dbSync.collectionsFilterMap[collectionName](collectionName, customFilter, filter) : customFilter;

            return connection
              .collection(allCollections[collectionName])
              .find(mongoDBFilter, excludes, (err, result) => {
                if (err) {
                  return callback(err);
                }

                // retrieve
                result.toArray((err, records) => {
                  if (err) {
                    return callback(err);
                  }

                  // export related files
                  // if collection is not supported, it will be skipped
                  dbSync.exportCollectionRelatedFiles(collectionName, records, tmpDirName, (err) => {
                    if (err) {
                      return callback(err);
                    }
                    // create a file with collection name as file name, containing results
                    fs.writeFile(`${tmpDirName}/${collectionName}.json`, JSON.stringify(records, null, 2), callback);
                  });
                });
              });
          };
        }),
        (err) => {
          if (err) {
            return done(err);
          }

          // archive file name
          let archiveName = `${tmpDirName}/snapshot_${Moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;

          // compress all collection files from the tmp dir into .zip file
          try {
            let zip = new AdmZip();
            zip.addLocalFolder(tmpDirName);
            zip.writeZip(archiveName);
          } catch (zipError) {
            app.logger.error(`Failed to create zip file. ${zipError}`);
            return done(zipError);
          }

          // log archive name location
          app.logger.debug(`Sync payload created at ${archiveName}`);

          // no password provided, return file path as is
          if (!options.password) {
            return done(null, archiveName);
          }
          // password provided, encrypt archive
          return app.utils.fileCrypto
            .encrypt(options.password, {}, archiveName)
            .then(function (archiveName) {
              return done(null, archiveName);
            })
            .catch(done);
        }
      );
  };

  /**
   * Extract a database snapshot archive to a temporary directory
   * And sync with the current database
   * Note: The sync doesn't stop at an error but the entire action will return an error for failed collection/collection record
   * Note: Before the sync a backup can be triggered if the triggerBackupBeforeSync flag is true or if it is not sent and the systemSettings.sync.triggerBackupBeforeSync is true
   * Note: In case of error the function will return 2 types
   * fatal - sync was not started due to corrupt archive/JSON files or equivalent
   * partial - sync was finished but some records sync failed
   * Error format:
   * {
   *  errorType: Sync.errorType.fatal/partial
   *  errorMessage: error
   * }
   * @param filePath
   * @param syncLogEntry Sync log entry for the current sync
   * @param outbreakIDs List of outbreak IDs for the outbreaks that can be synced
   * @param reqOptions
   * @param triggerBackupBeforeSync Flag which if sent overrides the systemSettings flag
   * @param options {{password: '<decryptPassword>'}}
   * @param callback
   */
  Sync.syncDatabaseWithSnapshot = function (filePath, syncLogEntry, outbreakIDs, reqOptions, triggerBackupBeforeSync, options, callback) {
    // default options
    options = options || {};
    // check if backup should be triggered
    app.models.systemSettings
      .getCache()
      .then(function (systemSettings) {
        // backup if needed
        if (triggerBackupBeforeSync || (typeof triggerBackupBeforeSync === 'undefined' && _.get(systemSettings, 'sync.triggerBackupBeforeSync'))) {
          let backupSettings = systemSettings.dataBackup;
          app.logger.debug(`Sync ${syncLogEntry.id}: Backup before sync is enabled. Starting backup process`);
          return app.models.backup.createBackup(backupSettings.location, backupSettings.modules, `Sync ${syncLogEntry.id}`);
        } else {
          return app.logger.debug(`Sync ${syncLogEntry.id}: Backup before sync is disabled. Proceeding with sync process`);
        }
      })
      .then(function (backupEntry) {
        if (backupEntry) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Backup process completed successfully. Backup ID: ${backupEntry.id}`);
        }

        // create a temporary directory to store the database files
        // it always created the folder in the system temporary directory
        let tmpDir = tmp.dirSync({unsafeCleanup: true});
        let tmpDirName = tmpDir.name;

        app.logger.debug(`Sync ${syncLogEntry.id}: Importing the DB at ${filePath}`);

        // define archive decryption action
        let decryptArchive;
        // if no password was provided
        if (!options.password) {
          // nothing to do, return file path as is
          decryptArchive = Promise.resolve(filePath);
        } else {
          // password provided, decrypt archive
          decryptArchive = app.utils.fileCrypto
            .decrypt(options.password, {}, filePath);
        }

        return decryptArchive
          .then(function (filePath) {
            // log the path of the payload
            app.logger.debug(`Payload saved at ${filePath}`);
            // extract the compressed database snapshot into the newly created temporary directory
            try {
              let archive = new AdmZip(filePath);
              archive.extractAllTo(tmpDirName);
            } catch (zipError) {
              app.logger.error(`Sync ${syncLogEntry.id}: Failed to extract zip archive: ${filePath}. ${zipError}`);
              return callback(Sync.getFatalError(typeof zipError === 'string' ? { message: zipError } : zipError));
            }

            // read all files in the temp dir
            return fs.readdir(tmpDirName, (err, filenames) => {
              if (err) {
                return callback(Sync.getFatalError(err));
              }

              // filter files that match a collection name
              let collectionsFiles = filenames.filter((filename) => {
                // split filename into 'collection name' and 'extension'
                filename = filename.split('.');
                return filename[0] && dbSync.collectionsMap.hasOwnProperty(filename[0]);
              });

              // create a list that will contain list of collection with failed records
              let failedIds = {};
              // initialize array containing collections that need to be imported and map of collections that entirely fail on import
              let collectionsToImport = [];
              let failedCollections = {};
              let failedCollectionsRelatedFiles = {};

              // read each file's contents and sync with database
              // not syncing in parallel to not load all collections in memory at once
              return async.series(
                collectionsFiles.map((fileName) => (doneCollection) => {
                  let filePath = `${tmpDirName}/${fileName}`;

                  // split filename into 'collection name' and 'extension'
                  let collectionName = fileName.split('.')[0];
                  // add collection to the list of collections to import
                  collectionsToImport.push(collectionName);

                  // cache reference to Loopback's model
                  let model = app.models[dbSync.collectionsMap[collectionName]];

                  return fs.readFile(
                    filePath,
                    {
                      encoding: 'utf8'
                    },
                    (err, data) => {
                      // create failed records entry
                      failedIds[collectionName] = [];

                      if (err) {
                        app.logger.error(`Sync ${syncLogEntry.id}: Failed to read collection file ${filePath}. ${err}`);
                        // keep failed collection with error
                        failedCollections[collectionName] = `Failed to read collection file ${filePath}. ${err}`;
                        return doneCollection();
                      }

                      // sync collection records in parallel
                      const syncRecords = function (done) {
                        // parse file contents to JavaScript object
                        try {
                          let collectionRecords = JSON.parse(data);

                          return async.parallelLimit(
                            collectionRecords.map((collectionRecord) => (doneRecord) => {
                              // convert mongodb id notation to Loopback notation
                              // to be consistent with external function calls
                              collectionRecord.id = collectionRecord._id;

                              // if needed for the collection, check for collectionRecord outbreakId
                              if (outbreakIDs.length &&
                                dbSync.collectionsImportFilterMap[collectionName] &&
                                !dbSync.collectionsImportFilterMap[collectionName](collectionName, collectionRecord, outbreakIDs)) {
                                app.logger.debug(`Sync ${syncLogEntry.id}: Skipped syncing record (collection: ${collectionName}, id: ${collectionRecord.id}) as it's outbreak ID is not accepted`);
                                return doneRecord();
                              }

                              // sync the record with the main database
                              dbSync.syncRecord(app.logger, model, collectionRecord, reqOptions, (err) => {
                                if (err) {
                                  app.logger.debug(`Sync ${syncLogEntry.id}: Failed syncing record (collection: ${collectionName}, id: ${collectionRecord.id}). Error: ${err.message}`);
                                  failedIds[collectionName].push(`ID: "${collectionRecord.id}". Error: ${err.message}`);
                                }
                                return doneRecord();
                              });
                            }), 10,
                            () => {
                              if (!failedIds[collectionName].length) {
                                delete failedIds[collectionName];
                              }

                              return done();
                            }
                          );
                        } catch (parseError) {
                          app.logger.error(`Sync ${syncLogEntry.id}: Failed to parse collection file ${filePath}. ${parseError}`);
                          // keep failed collection with error
                          failedCollections[collectionName] = `Failed to parse collection file ${filePath}. ${parseError}`;
                          return done();
                        }
                      };

                      // sync collection related files, if necessary
                      if (dbSync.collectionsWithFiles.hasOwnProperty(collectionName)) {
                        dbSync.importCollectionRelatedFiles(collectionName, tmpDirName, (err) => {
                          if (err) {
                            failedCollectionsRelatedFiles[collectionName] = `Failed to copy related files. ${err}`;
                          }
                          return syncRecords(doneCollection);
                        });
                      } else {
                        return syncRecords(doneCollection);
                      }
                    });
                }),
                () => {
                  // on debug, keep payload
                  if (!syncConfig.debug) {
                    // remove temporary directory
                    tmpDir.removeCallback();

                    // remove temporary uploaded file
                    fs.unlink(filePath, () => {
                      app.logger.debug(`Sync ${syncLogEntry.id}: Removed temporary files at ${filePath}`);
                    });
                  } else {
                    // log sync running in debug mode
                    app.logger.info('Sync running in debug mode, no cleanup performed');
                  }

                  // The sync doesn't stop at an error but the entire action will return an error for failed collection/collection record
                  // check for failed collections/collection records
                  // initialize error
                  let err = null;

                  // check entirely failed collections
                  let entirelyFailedCollections = Object.keys(failedCollections);
                  if (entirelyFailedCollections.length) {
                    err = 'Failed collections: ';
                    entirelyFailedCollections.forEach(function (collectionName) {
                      err += `Collection ${collectionName}. Error: ${failedCollections[collectionName]}`;
                    });
                  }

                  // check if all the collections that needed to be imported failed entirely
                  if (collectionsToImport.length === entirelyFailedCollections.length) {
                    // fatal sync error
                    return callback(Sync.getFatalError(err));
                  }

                  // some/all collections could be imported check for failed records
                  let collectionsWithFailedRecords = Object.keys(failedIds);
                  if (collectionsWithFailedRecords.length) {
                    err = err || '';
                    err += 'Failed records: ';
                    collectionsWithFailedRecords.forEach(function (collectionName) {
                      err += `Collection ${collectionName}. Records: ${failedIds[collectionName].join('; ')} `;
                    });
                  }

                  // some/all collections could fail when copying related files
                  if (failedCollectionsRelatedFiles.length) {
                    err = err || '';
                    err += 'Failed collections with related files: ';
                    for (let collectionName in failedCollectionsRelatedFiles) {
                      err += `Collection ${collectionName}. Error: ${failedCollectionsRelatedFiles[collectionName]} `;
                    }
                  }

                  return callback(err ? Sync.getPartialError(err) : null);
                }
              );
            });
          });
      })
      .catch(function (backupError) {
        return callback(Sync.getFatalError(backupError));
      });
  };

  /**
   * Retrieve the available outbreaks IDs from the upstream server
   * @param upstreamServer
   * @param syncLogEntry
   */
  Sync.getAvailableOutbreaksIDs = function (upstreamServer, syncLogEntry) {
    let client = new SyncClient(upstreamServer, syncLogEntry);
    return client.getAvailableOutbreaks();
  };

  /**
   * Send database to server for import
   * @param upstreamServer
   * @param DBSnapshotFileName
   * @param asynchronous Flag to specify to the server whether the import should be done sync/async
   * @param syncLogEntry Note: Errors will be added to the syncLogEntry for the case where the server import succeeded with warnings
   */
  Sync.sendDBSnapshotForImport = function (upstreamServer, DBSnapshotFileName, asynchronous, syncLogEntry) {
    // asynchronous flag needs to be parsed to string as this is how it is needed for the request
    if (typeof asynchronous !== 'string') {
      // if boolean was sent recognize it and parse it to string
      asynchronous = asynchronous === true ? 'true' : 'false';
    }

    // get client to upstream server
    let client = new SyncClient(upstreamServer, syncLogEntry);

    // depending on the asynchronous flag we need to return directly the response or wait do checks to see if the import was successful
    if (asynchronous === 'true') {
      // import is async
      app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import is being done in async mode`);
      return client.sendDBSnapshotForImport(DBSnapshotFileName, asynchronous)
        .then(function (syncLogId) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import: received upstream server sync log id: ${syncLogId}`);
          // initialize container for server sync log entry status check connection error
          // will be updated only with connection errors
          let statusCheckConnectionError = null;

          // import started and syncLog entry was created
          // need to check at defined intervals the syncLog entry status
          // checking until a defined period passes
          return new Promise(function (resolve, reject) {
            app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import: Checking upstream server sync status for ${asyncActionsSettings.actionTimeout} milliseconds at an interval of ${asyncActionsSettings.intervalTimeout} milliseconds`);
            let totalActionsTimeout, actionTimeout;
            // initialize flag to know when the totalActionsTimeout was reached
            let totalActionsTimeoutReached = false;
            // create timeout until to check for sync log entry status
            totalActionsTimeout = setTimeout(function () {
              // set totalActionsTimeoutReached to true
              totalActionsTimeoutReached = true;

              // timeout is reached and the import action was not finished
              app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import failed. Upstream server sync status was not updated in time (${asyncActionsSettings.actionTimeout} milliseconds)`);

              // clear action timeout
              clearTimeout(actionTimeout);

              // return error
              reject(app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_FAILED', {
                upstreamServerName: client.upstreamServerName,
                error: `Upstream server sync status was not updated in time (${asyncActionsSettings.actionTimeout} milliseconds). ${statusCheckConnectionError ? `Latest status check error was a connection error: ${statusCheckConnectionError}` : ''}`
              }));
            }, asyncActionsSettings.actionTimeout);

            // get syncLog entry to check status
            function getSyncLogEntry() {
              client.getSyncLogEntry(syncLogId)
                .then(function (serverSyncLogEntry) {
                  // check if the totalActionsTimeout was reached; there is a possibility that the totalActionsTimeout was reached but this function was already in execution
                  // in that case nothing should happen in this function
                  if (totalActionsTimeoutReached) {
                    app.logger.debug(`Sync ${syncLogEntry.id}: Total action timeout was reached when the sync log check was in execution. Stopping sync log check response handling`);
                    return;
                  }

                  // remove any saved status Check Connection Error
                  statusCheckConnectionError = null;

                  // check sync status
                  if (serverSyncLogEntry.status === 'LNG_SYNC_STATUS_IN_PROGRESS') {
                    // upstream server import is in progress; nothing to do
                    app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import is in progress`);
                    // check again after the interval has passed
                    actionTimeout = setTimeout(getSyncLogEntry, asyncActionsSettings.intervalTimeout);
                    return;
                  }

                  if (serverSyncLogEntry.status === 'LNG_SYNC_STATUS_FAILED') {
                    // upstream server import failed
                    app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import failed: upstream server sync status is 'failed'. Fail reason ${serverSyncLogEntry.error}`);
                    reject(app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_FAILED', {
                      upstreamServerName: client.upstreamServerName,
                      error: serverSyncLogEntry.error
                    }));
                  } else {
                    // upstream server import success
                    // there may be warnings
                    if (serverSyncLogEntry.status === 'LNG_SYNC_STATUS_SUCCESS_WITH_WARNINGS') {
                      app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import succeeded with some errors: ${serverSyncLogEntry.error}`);
                      // add the server error to the syncLog
                      syncLogEntry.addError(`Upstream server import errors: ${serverSyncLogEntry.error}`);
                    } else {
                      app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import success`);
                    }
                    resolve(syncLogId);
                  }

                  // clear totalActions timeout
                  clearTimeout(totalActionsTimeout);
                })
                .catch(function (err) {
                  // check if the totalActionsTimeout was reached; there is a possibility that the totalActionsTimeout was reached but this function was already in execution
                  // in that case nothing should happen in this function
                  if (totalActionsTimeoutReached) {
                    app.logger.debug(`Sync ${syncLogEntry.id}: Total action timeout was reached when the sync log check was in execution. Stopping sync log check response handling`);
                    return;
                  }

                  // syncLogEntry couldn't be retrieved; log error; will retry on the next interval
                  app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import: Couldn't check upstream server sync status. Retrying after the next interval. Error ${err}`);
                  // save status check connection error
                  statusCheckConnectionError = err;

                  // check again after the interval has passed
                  actionTimeout = setTimeout(getSyncLogEntry, asyncActionsSettings.intervalTimeout);
                });
            }

            // start upstream server sync log status checks
            actionTimeout = setTimeout(getSyncLogEntry, asyncActionsSettings.intervalTimeout);
          });
        });
    } else {
      // import is sync; nothing else to do
      app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import is being done in sync mode`);
      return client.sendDBSnapshotForImport(DBSnapshotFileName, asynchronous)
        .then(function (syncLogId) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import success. Received upstream server sync log id: ${syncLogId}`);
          return syncLogId;
        });
    }
  };

  /**
   * Check if there is a pending sync for the given server
   * If a pending sync was found and there is no sync in progress, trigger it, else keep it in pending
   * @param server
   * @param options
   */
  Sync.checkAndTriggerPendingSync = function (server, options) {
    let syncInProgressMap = Sync.inProgress.servers;
    let syncInPendingMap = Sync.pending.servers;

    // check if there is a pending sync for the server
    if (syncInPendingMap[server.url]) {
      // there is a sync in pending state; start the sync if there is no sync in progress
      if (syncInProgressMap[server.url]) {
        app.logger.debug(`Sync on every change: There is already a sync in progress with server '${server.name}'. Sync is pending completion of the current sync process`);
        syncInPendingMap[server.url] = true;
      } else {
        // initialize sync params
        let data = {
          upstreamServerURL: server.url,
          triggerBackupBeforeSync: false,
          // send forceSync flag; needed because we set the sync in progress flag for the server in this function to not wait for the Sync.sync functionality
          // if we wait there might be more 'after save' hooks triggered before Sync.sync sets the in progress status
          forceSync: true
        };
        // clone options; Keeping only the details required for audit log
        let newOptions = {
          remotingContext: {
            req: {
              authData: {
                user: Object.assign({}, _.get(options, 'remotingContext.req.authData.user', {}))
              },
              headers: _.get(options, 'remotingContext.req.headers'),
              connection: _.get(options, 'remotingContext.req.connection')
            }
          },
          syncOnEveryChange: true
        };
        if (!options.syncOnEveryChange) {
          // add a (Sync on every change) suffix to the user ID to be saved in the sync log entry audit log
          _.set(newOptions, 'remotingContext.req.authData.user.id', `${_.get(newOptions, 'remotingContext.req.authData.user.id')} (Sync on every change)`);
        }
        app.logger.debug(`Sync on every change: Started sync with server '${server.name}'`);
        // start the sync process
        Sync.sync(data, newOptions, function (err, syncLogId) {
          if (err) {
            app.logger.debug(`Sync on every change: Sync with server '${server.name}' failed with error: ${err}`);
          } else {
            app.logger.debug(`Sync on every change: Sync with server '${server.name}' is progressing having sync log ID ${syncLogId}`);
          }
        });

        // add server to sync in progress list
        syncInProgressMap[server.url] = true;

        // remove server from pending sync list
        syncInPendingMap[server.url] = false;
      }
    } else {
      // no pending sync; nothing to do
    }
  };
};
