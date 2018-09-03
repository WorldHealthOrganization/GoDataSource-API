'use strict';

// requires
const app = require('../server/server');
const fs = require('fs');
const path = require('path');
const async = require('async');
const tar = require('tar');
const tmp = require('tmp');
const dbSync = require('./dbSync');
const helpers = require('../components/helpers');

/**
 * Create a new backup
 * Returns the path of the backup file
 * @param modules
 * @param location
 * @param done
 */
const createBackup = function (modules, location, done) {
  const models = app.models;
  const backupModel = models.backup;

  // collect all collections that must be exported, based on the modules
  let collections = [];
  modules.forEach((module) => {
    if (backupModel.modules.hasOwnProperty(module)) {
      collections.push(...backupModel.modules[module]);
    }
  });

  try {
    // make sure the location path of the backups exists and is accessible
    helpers.isPathOK(location);

    // run the database export
    models.sync.exportDatabase(null, collections, null, (exportError, archivePath) => {
      if (exportError) {
        app.logger.error(`Backup process failed. ${exportError}`);
        return done(exportError);
      }

      // get file name from archive path
      let fileParse = path.parse(archivePath);
      let fileName = fileParse.name + fileParse.ext;

      // build new path for the backup file
      let newPath = `${location}/${fileName}`;

      // copy the archive from temporary OS directory to the desired location
      fs.copyFile(archivePath, newPath, (copyError) => {
        if (copyError) {
          app.logger.error(`Failed to copy backup file from ${archivePath} to ${newPath}. ${copyError}`);
          return done(copyError);
        }
        return done(null, newPath);
      });
    });
  } catch (pathAccessError) {
    app.logger.error(`Backup location: ${location} is not OK. ${pathAccessError}`);
    return done(pathAccessError);
  }
};

/**
 * Restore the system using a backup file
 * @param backupId
 * @param done
 */
const restoreBackup = function (backupId, done) {
  app.models.backup
    .findOne({
      where: {
        id: backupId
      }
    })
    .then((backup) => {
      if (!backup) {
        return done(app.utils.apiError.getError('MODEL_NOT_FOUND', {
          model: app.models.backup.modelName,
          id: backupId
        }));
      }

      // begin backup restore
      restoreBackupFromFile(backup.location, (err) => done(err));
    })
    .catch((err) => done(err));
};

/**
 * Restore a backup from file
 * @param filePath
 * @param done
 */
const restoreBackupFromFile = function (filePath, done) {
  // cache reference to mongodb connection
  let connection = app.dataSources.mongoDb.connector;

  try {
    // make sure the location path of the backups exists and is accessible
    helpers.isPathOK(filePath);

    // create a temporary directory to store the backup files
    let tmpDir = tmp.dirSync({ unsafeCleanup: true });
    let tmpDirName = tmpDir.name;

    // extract backup archive
    tar.x(
      {
        cwd: tmpDirName,
        file: filePath
      },
      (err) => {
        if (err) {
          return done(err);
        }

        // read backup files in the temporary dir
        return fs.readdir(tmpDirName, (err, filenames) => {
          if (err) {
            return done(err);
          }

          // filter files that match a collection name
          let collectionsFiles = filenames.filter((filename) => {
            // split filename into 'collection name' and 'extension'
            filename = filename.split('.');
            return filename[0] && dbSync.collectionsMap.hasOwnProperty(filename[0]);
          });

          // start restoring the database using provided collection files
          return async.series(
            collectionsFiles.map((fileName) => (doneCollection) => {
              let filePath = `${tmpDirName}/${fileName}`;

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

                    // split filename into 'collection name' and 'extension'
                    let collectionName = fileName.split('.')[0];

                    // get collection reference of the mongodb driver
                    let collectionRef = connection.collection(dbSync.collectionsMap[collectionName]);

                    // remove all the documents from the collection, then bulk insert the ones from the file
                    collectionRef.deleteMany({}, (err) => {
                      // if delete fails, don't continue
                      if (err) {
                        app.logger.error(`Failed to delete database records of collection: ${collectionName}. ${err}`);
                        return doneCollection();
                      }

                      // if there are no records in the files just
                      // skip it
                      if (!collectionRecords.length) {
                        app.logger.debug(`Collection ${collectionName} has no records in the file. Skipping it.`);
                        return doneCollection();
                      }

                      // create a bulk operation
                      const bulk = collectionRef.initializeOrderedBulkOp();

                      // insert all entries from the file in the collection
                      collectionRecords.forEach((record) => {
                        bulk.insert(record);
                      });

                      // execute the bulk operations
                      // in case an error has occurred, log it and continue
                      // we do not stop the operation
                      bulk.execute((err) => {
                        if (err) {
                          app.logger.error(`Failed to insert records for collection ${collectionName}. ${err}`);
                          // this is a database connection error, should stop here
                          return doneCollection(err);

                        }
                        return doneCollection();
                      });
                    });
                  } catch (parseError) {
                    app.logger.error(`Failed to parse collection file ${filePath}. ${parseError}`);
                    return doneCollection();
                  }
                });
            }),
            (err) => done(err)
          );
        });
      });

  } catch (pathAccessError) {
    app.logger.error(`Backup location: ${filePath} is not OK. ${pathAccessError}`);
    return done(pathAccessError);
  }
};

/**
 * Used to delete backups after a manual restore and for retention routine
 * @param backup
 * @param callback
 */
const removeBackup = function (backup, callback) {
  let a = 1;

  return async.series([
    (done) => {
      if (backup.location) {
        fs.unlink(backup.location, (err) => {
          if (err) {
            app.logger.warn(`Failed to remove ${backup.location} for ${backup.id}. ${err}`);
            return done(err);
          }
          return done();
        });
      }
    },
    (done) => {
      // remove the backup record
      app.models.backup.deleteById(backup.id, (err) => {
        if (err) {
          app.logger.warn(`Failed to remove backup record: ${backup.id} from database. ${err}`);
          return done(err);
        }
        return done();
      });
    }
  ], (err) => callback(err));
};


/**
 * Used to clean up older backups
 * It deletes records in the database and archives on the disk
 * @param currentDate
 */
const removeBackups = function (currentDate) {
  const backupModel = app.models.backup;

  // retrieve all backups that are older
  backupModel
    .find({
      where: {
        date: {
          lt: currentDate
        }
      }
    })
    .then((olderBackups) => olderBackups.forEach((backup) => removeBackup(backup)));
};

module.exports = {
  create: createBackup,
  restore: restoreBackup,
  remove: removeBackup,
  restoreFromFile: restoreBackupFromFile,
  removeBackups: removeBackups
};
