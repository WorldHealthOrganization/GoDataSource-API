'use strict';

// requires
const AdmZip = require('adm-zip');
const app = require('../server/server');
const fs = require('fs');
const path = require('path');
const async = require('async');
const tmp = require('tmp');
const dbSync = require('./dbSync');
const helpers = require('../components/helpers');
const _ = require('lodash');
const moment = require('moment');

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
    let pathErr = `Backup location: '${location}' is not OK. ${pathAccessError}`;
    app.logger.error(pathErr);
    return done(pathErr);
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

  // establish database connection before anything
  connection.connect((mongoDbConnError) => {
    if (mongoDbConnError) {
      app.logger.error('Failed to establish database connection');
      return done(mongoDbConnError);
    }

    try {
      // make sure the location path of the backups exists and is accessible
      helpers.isPathOK(filePath);

      // create a temporary directory to store the backup files
      let tmpDir = tmp.dirSync({ unsafeCleanup: true });
      let tmpDirName = tmpDir.name;

      // extract backup archive
      try {
        let archive = new AdmZip(filePath);
        archive.extractAllTo(tmpDirName);
      } catch (zipError) {
        app.logger.error(`Failed to extract zip archive: ${filePath}`);
        return done(zipError);
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
                  app.logger.error(`Failed to read collection file ${filePath}`);
                  return doneCollection(err);
                }

                // split filename into 'collection name' and 'extension'
                let collectionName = fileName.split('.')[0];

                let collectionRef = null;

                try {
                  // get collection reference of the mongodb driver
                  collectionRef = connection.collection(dbSync.collectionsMap[collectionName]);
                } catch (mongoDbError) {
                  app.logger.error(`Failed to establish connection to ${collectionName} collection`);
                  return doneCollection(mongoDbError);
                }

                // list of date map properties to convert
                let datePropsMap = app.models[collectionName]._parsedDateProperties;

                // parse file contents to JavaScript object
                try {
                  let collectionRecords = JSON.parse(data);

                  collectionRecords.forEach((record) => {
                    // custom properties should be checked property by property
                    // we can't know exactly the types
                    if (record.questionnaireAnswers) {
                      helpers.convertPropsToDate(record.questionnaireAnswers);
                    }

                    let specialDatePropsMap = null;
                    if (record.hasOwnProperty('type') &&
                      [
                        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                      ].indexOf(record.type) >= 0) {
                      specialDatePropsMap = app.models[app.models.person.typeToModelMap[record.type]]._parsedDateProperties;
                    }

                    (function setDateProps(obj, map) {
                      // go through each date properties and parse date properties
                      for (let prop in map) {
                        if (map.hasOwnProperty(prop)) {
                          // this is an array prop
                          if (typeof map[prop] === 'object') {
                            if (Array.isArray(obj[prop])) {
                              obj[prop].forEach((item) => setDateProps(item, map[prop]));
                            }
                          } else {
                            let recordPropValue = _.get(obj, prop);
                            if (recordPropValue) {
                              // try to convert the string value to date, if valid, replace the old value
                              let convertedDate = moment(recordPropValue);
                              if (convertedDate.isValid()) {
                                _.set(obj, prop, convertedDate.toDate());
                              }
                            }
                          }
                        }
                      }
                    })(record, specialDatePropsMap ? specialDatePropsMap : datePropsMap);
                  });

                  // restore a collection's record using raw mongodb connector
                  const restoreCollection = function () {
                    // remove all the documents from the collection, then bulk insert the ones from the file
                    collectionRef.deleteMany({}, (err) => {
                      // if delete fails, don't continue
                      if (err) {
                        app.logger.error(`Failed to delete database records of collection: ${collectionName}`);
                        return doneCollection(err);
                      }

                      // if there are no records in the files just
                      // skip it
                      if (!collectionRecords.length) {
                        app.logger.debug(`Collection ${collectionName} has no records in the file. Skipping it`);
                        return doneCollection();
                      }

                      // create a bulk operation
                      const bulk = collectionRef.initializeOrderedBulkOp();

                      // insert all entries from the file in the collection
                      collectionRecords.forEach((record) => {
                        bulk.insert(record);
                      });

                      // execute the bulk operations
                      bulk.execute((err) => {
                        if (err) {
                          app.logger.error(`Failed to insert records for collection ${collectionName}`);
                          // stop at once, if any error has occurred
                          return doneCollection(err);
                        }
                        return doneCollection();
                      });
                    });
                  };

                  // copy collection linked files
                  if (dbSync.collectionsWithFiles.hasOwnProperty(collectionName)) {
                    dbSync.importCollectionRelatedFiles(collectionName, tmpDirName, (err) => {
                      if (err) {
                        return doneCollection();
                      }
                      return restoreCollection();
                    });
                  } else {
                    return restoreCollection();
                  }
                } catch (parseError) {
                  app.logger.error(`Failed to parse collection file ${filePath}`);
                  return doneCollection(parseError);
                }
              });
          }),
          (err) => done(err)
        );
      });
    } catch (pathAccessError) {
      app.logger.error(`Backup location: ${filePath} is not OK. ${pathAccessError}`);
      return done(pathAccessError);
    }
  });
};

/**
 * Used to delete backups after a manual restore and for retention routine
 * @param backup
 * @param callback
 */
const removeBackup = function (backup, callback) {
  return async.series([
    (done) => {
      // remove the backup record
      app.models.backup.deleteById(backup.id, (err) => {
        if (err) {
          app.logger.warn(`Failed to remove backup record: ${backup.id} from database. ${err}`);
          return done(err);
        }
        return done();
      });
    },
    (done) => {
      if (backup.location) {
        return fs.unlink(backup.location, (err) => {
          if (err) {
            app.logger.warn(`Failed to remove ${backup.location} for ${backup.id}. ${err}`);
            return done(err);
          }
          return done();
        });
      }
      return done();
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

/**
 * Retrieve system settings get backup timings, check backup location
 * Used mainly for backup routines (create, cleanup)
 * @parma done
 */
const preRoutine = function (done) {
  // retrieve system settings and get backup timings
  app.models.systemSettings
    .getCache()
    .then((systemSettings) => {
      // data backup configuration is not available, do nothing
      if (!systemSettings.dataBackup) {
        app.logger.warn('Backup settings not available.');
        return done(true);
      }

      // cache backup settings
      let backupSettings = systemSettings.dataBackup;

      // make sure the backup location is ok
      fs.access(backupSettings.location, fs.F_OK, (accessError) => {
        if (accessError) {
          app.logger.error(`Configured backup location: ${backupSettings.location} is not OK. ${accessError}`);
          return done(accessError);
        }

        return done(null, backupSettings);
      });
    });
};


module.exports = {
  create: createBackup,
  restore: restoreBackup,
  remove: removeBackup,
  restoreFromFile: restoreBackupFromFile,
  removeBackups: removeBackups,
  preRoutine: preRoutine
};
