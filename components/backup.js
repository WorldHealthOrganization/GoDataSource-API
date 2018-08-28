'use strict';

// requires
const app = require('../server/server');
const fs = require('fs');
const path = require('path');
const async = require('async');
const tar = require('tar');
const tmp = require('tmp');
const dbSync = require('./dbSync');

/**
 * Create a new backup file at the desired location and for given application modules
 * @param userId
 * @param modules
 * @param location
 * @param done
 */
const createBackup = function (userId, modules, location, done) {
  const models = app.models;

  // collect all collections that must be exported, based on the modules
  let collections = [];
  modules.forEach((module) => {
    if (models.backup.modules.hasOwnProperty(module)) {
      collections.push(...app.models.backup.modules[module]);
    }
  });

  // make sure the location path of the backups exists and is accessible
  fs.access(location, fs.F_OK, (accessError) => {
    if (accessError) {
      app.logger.error(`Backup location: ${location} is not OK. ${accessError}`);
      return done(accessError);
    }

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
          app.logger.error(`Failed to copy backup file from path ${archivePath} to ${newPath}. ${copyError}`);
          return done(copyError);
        }

        // create new backup record
        models.backup
          .create(
            {
              automatic: false,
              modules: modules,
              location: newPath,
              userId: userId
            }
          )
          .then((record) => done(null, record.id))
          .catch((createError) => done(createError));
      });
    });
  });
};

/**
 * Restore the system using a backup entry
 * @param backupId
 * @param done
 */
const restoreBackup = function (backupId, done) {
  app.models.backup
    .findOne({ where: { id: backupId } })
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

  // make sure the file actually exists and is accessible
  fs.access(filePath, fs.F_OK, (accessError) => {
    if (accessError) {
      app.logger.error(`Backup file: ${filePath} is not OK. ${accessError}`);
      return done(accessError);
    }

    // // create a temporary directory to store the database files
    // it always created the folder in the system temporary directory
    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    // extract the compressed database snapshot into the newly created temporary directory
    tar.x(
      {
        cwd: tmpDirName,
        file: filePath
      },
      (err) => {
        if (err) {
          return done(err);
        }

        // read all files in the temp dir
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

          // read each file's contents and sync with database
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
                      // create a bulk operation
                      const bulk = collectionRef.initializeOrderedBulkOp();

                      // insert all entries from the file in the collection
                      collectionRecords.forEach((record) => {
                        bulk.insert(record);
                      });

                      // execute the bulk operations
                      bulk.execute((err) => {
                        if (err) {
                          app.logger.error(`Failed to insert records for collection ${collectionName}. ${err}`);
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
  });
};

module.exports = {
  create: createBackup,
  restore: restoreBackup,
  restoreFromFile: restoreBackupFromFile
};
