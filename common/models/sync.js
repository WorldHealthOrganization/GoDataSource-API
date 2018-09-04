'use strict';

// requires
const tmp = require('tmp');
const async = require('async');
const app = require('../../server/server');
const fs = require('fs');
const dbSync = require('../../components/dbSync');
const AdmZip = require('adm-zip');
const request = require('request-promise-native');
const SyncClient = require('../../components/syncClient');
const asyncActionsSettings = require('../../server/config.json').asyncActionsSettings;

module.exports = function (Sync) {
  Sync.hasController = true;

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
   * @param done
   */
  Sync.exportDatabase = function (filter, collections, collectionsOpts, done) {
    // defensive checks
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
          $gte: filter.where.fromDate
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

                  // Note: Encryption is not supported yet
                  // create a file with collection name as file name, containing results
                  fs.writeFile(`${tmpDirName}/${collectionName}.json`, JSON.stringify(records), callback);
                });
              });
          };
        }),
        (err) => {
          if (err) {
            return done(err);
          }

          // archive file name
          let archiveName = `${tmpDirName}/db_snapshot_${Date.now()}.zip`;

          // compress all collection files from the tmp dir into .zip file
          try {
            let zip = new AdmZip();
            zip.addLocalFolder(tmpDirName);
            zip.writeZip(archiveName);
          } catch (zipError) {
            app.logger.error(`Failed to create zip file. ${zipError}`);
            return done(zipError);
          }

          return done(null, archiveName);
        }
      );
  };

  /**
   * Extract a database snapshot archive to a temporary directory
   * And sync with the current database
   * Note: The sync doesn't stop at an error but the entire action will return an error for failed collection/collection record
   * @param filePath
   * @param syncLogEntry Sync log entry for the current sync
   * @param outbreakIDs List of outbreak IDs for the outbreaks that can be synced
   * @param reqOptions
   * @param callback
   */
  Sync.syncDatabaseWithSnapshot = function (filePath, syncLogEntry, outbreakIDs, reqOptions, callback) {
    // create a temporary directory to store the database files
    // it always created the folder in the system temporary directory
    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    // create a list that will contain list of collection with failed records
    let failedIds = {};

    // create a list that will contain list of collections that failed entirely
    let failedCollections = [];

    // extract the compressed database snapshot into the newly created temporary directory
    try {
      let archive = new AdmZip(filePath);
      archive.extractAllTo(tmpDirName);
    } catch (zipError) {
      app.logger.error(`Failed to extract zip archive: ${filePath}. ${zipError}`);
      return callback(zipError);
    }

    // read all files in the temp dir
    return fs.readdir(tmpDirName, (err, filenames) => {
      if (err) {
        return callback(err);
      }

      // filter files that match a collection name
      let collectionsFiles = filenames.filter((filename) => {
        // split filename into 'collection name' and 'extension'
        filename = filename.split('.');
        return filename[0] && dbSync.collectionsMap.hasOwnProperty(filename[0]);
      });

      // read each file's contents and sync with database
      // not syncing in parallel to not load all collections in memory at once
      return async.series(
        collectionsFiles.map((fileName) => (doneCollection) => {
          let filePath = `${tmpDirName}/${fileName}`;

          // split filename into 'collection name' and 'extension'
          let collectionName = fileName.split('.')[0];

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
                    failedIds[collectionName].push('Entire collection');
                    return doneCollection();
                  }

              // parse file contents to JavaScript object
              try {
                let collectionRecords = JSON.parse(data);

                    return async.parallel(
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
                            failedIds[collectionName].push(collectionRecord.id);
                          }
                          return doneRecord();
                        });
                      }),
                      () => {
                        if (!failedIds[collectionName].length) {
                          delete failedIds[collectionName];
                        }

                        return doneCollection();
                      }
                    );
                  } catch (parseError) {
                    app.logger.error(`Sync ${syncLogEntry.id}: Failed to parse collection file ${filePath}. ${parseError}`);
                    // keep failed collections
                    failedCollections.push(collectionName);
                    return doneCollection();
                  }
                });
            }),
            () => {
              // remove temporary directory
              tmpDir.removeCallback();

          // remove temporary uploaded file
          fs.unlink(filePath);

              // The sync doesn't stop at an error but the entire action will return an error for failed collection/collection record
              // check for failed collections/collection records
              // initialize error
              let err = null;
              if (failedCollections.length) {
                err = `Failed collections: ${failedCollections.join(', ')}`;
              }
              let collectionsWithFailedRecords = Object.keys(failedIds);
              if (collectionsWithFailedRecords.length) {
                err = err || '';
                err += `Failed records: `;
                collectionsWithFailedRecords.forEach(function (collectionName) {
                  err += `Collection ${collectionName}. Records: ${failedIds[collectionName].join(', ')}. `;
                });
              }

          return callback(err);
        }
      );
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
   * @param syncLogEntry
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
          // import started and syncLog entry was created
          // need to check at defined intervals the syncLog entry status
          // checking until a defined period passes
          return new Promise(function (resolve, reject) {
            app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import: Checking upstream server sync status for ${asyncActionsSettings.actionTimeout} milliseconds at an interval of ${asyncActionsSettings.intervalTimeout} milliseconds`);
            let totalActionsTimeout, actionTimeout;
            // create timeout until to check for sync log entry status
            totalActionsTimeout = setTimeout(function () {
              // timeout is reached and the import action was not finished
              app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import failed. Upstream server sync status was not updated in time (${asyncActionsSettings.actionTimeout} milliseconds)`);

              // clear action timeout
              clearTimeout(actionTimeout);

              // return error
              reject(app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_FAILED', {
                upstreamServerName: client.upstreamServerName,
                failReason: `Upstream server sync status was not updated in time (${asyncActionsSettings.actionTimeout} milliseconds)`
              }));
            }, asyncActionsSettings.actionTimeout);

            // get syncLog entry to check status
            function getSyncLogEntry() {
              client.getSyncLogEntry(syncLogId)
                .then(function (syncLogEntry) {
                  // check syncStatus
                  if (syncLogEntry.syncStatus === 'LNG_SYNC_STATUS_IN_PROGRESS') {
                    // upstream server import is in progress; nothing to do
                    app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import is in progress`);
                    // check again after the interval has passed
                    actionTimeout = setTimeout(getSyncLogEntry, asyncActionsSettings.intervalTimeout);
                    return;
                  }

                  if (syncLogEntry.syncStatus === 'LNG_SYNC_STATUS_FAILED') {
                    // upstream server import failed
                    app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import failed: upstream server sync status is 'failed'. Fail reason ${syncLogEntry.failReason}`);
                    reject(app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_FAILED', {
                      upstreamServerName: client.upstreamServerName,
                      failReason: syncLogEntry.failReason
                    }));
                  } else {
                    // upstream server import success
                    app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import success`);
                    resolve(syncLogId);
                  }

                  // clear totalActions timeout
                  clearTimeout(totalActionsTimeout);
                })
                .catch(function (err) {
                  // syncLogEntry couldn't be retrieved; log error; will retry on the next interval
                  app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server import: Couldn't check upstream server sync status. Retrying after the next interval. Error ${err}`);
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
   * Get database from server
   * @param upstreamServer
   * @param asynchronous Flag to specify to the server whether the import should be done sync/async
   * @param syncLogEntry
   */
  Sync.getDBSnapshotFromUpstreamServer = function (upstreamServer, asynchronous, syncLogEntry) {
    if (typeof asynchronous !== 'boolean') {
      asynchronous = false;
    }

    // get client to upstream server
    let client = new SyncClient(upstreamServer, syncLogEntry);

    // initialize filter for DB snapshot export
    let filter = {
      where: {
        exclude: [
          'systemSettings',
          'team',
          'user',
          'role'
        ]
      }
    };

    // get data from date
    if (syncLogEntry.syncInformationStartDate) {
      filter.where.fromDate = syncLogEntry.syncInformationStartDate;
    }

    // depending on the asynchronous flag we need to return directly the response or wait do checks to see if the export was successful
    if (asynchronous === 'true') {
      // export is async
      // TODO Use backup functionality to do the export async
      app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server DB export is being done in sync mode`);
      return client.getDatabaseSnapshot(filter, asynchronous)
        .then(function (dbSnapshotFileName) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server DB export success. DB snapshot saved at: ${dbSnapshotFileName}`);
          return dbSnapshotFileName;
        });
    } else {
      // export is sync; nothing else to do
      app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server DB export is being done in sync mode`);
      return client.getDatabaseSnapshot(filter, asynchronous)
        .then(function (dbSnapshotFileName) {
          app.logger.debug(`Sync ${syncLogEntry.id}: Upstream server DB export success. DB snapshot saved at: ${dbSnapshotFileName}`);
          return dbSnapshotFileName;
        });
    }
  };
};
