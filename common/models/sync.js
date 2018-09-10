'use strict';

// requires
const tmp = require('tmp');
const async = require('async');
const app = require('../../server/server');
const fs = require('fs');
const dbSync = require('../../components/dbSync');
const AdmZip = require('adm-zip');

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

            return connection
              .collection(allCollections[collectionName])
              .find(customFilter, excludes, (err, result) => {
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
   * @param filePath
   * @param reqOptions
   * @param callback
   */
  Sync.syncDatabaseWithSnapshot = function (filePath, reqOptions, callback) {
    // create a temporary directory to store the database files
    // it always created the folder in the system temporary directory
    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    // create a list that will contain list of collection with failed records
    let failedIds = {};

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
      return async.parallel(
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
              if (err) {
                app.logger.error(`Failed to read collection file ${filePath}. ${err}`);
                return doneCollection();
              }

              // parse file contents to JavaScript object
              try {
                let collectionRecords = JSON.parse(data);

                // create failed records entry
                failedIds[collectionName] = [];

                return async.parallel(
                  collectionRecords.map((collectionRecord) => (doneRecord) => {
                    // convert mongodb id notation to Loopback notation
                    // to be consistent with external function calls
                    collectionRecord.id = collectionRecord._id;

                    // sync the record with the main database
                    dbSync.syncRecord(app.logger, model, collectionRecord, reqOptions, (err) => {
                      if (err) {
                        app.logger.debug(`Failed syncing record (id: ${collectionRecord.id}). Error: ${err.message}`);
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
                app.logger.error(`Failed to parse collection file ${filePath}. ${parseError}`);
                return doneCollection();
              }
            });
        }),
        () => {
          // remove temporary directory
          tmpDir.removeCallback();

          // remove temporary uploaded file
          fs.unlink(filePath);

          if (Object.keys(failedIds).length) {
            return callback(null, {failedRecords: failedIds});
          }

          return callback();
        }
      );
    });
  };
};
