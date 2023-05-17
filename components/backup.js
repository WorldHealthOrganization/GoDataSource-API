'use strict';

// requires
const app = require('../server/server');
const fs = require('fs');
const path = require('path');
const async = require('async');
const dbSync = require('./dbSync');
const helpers = require('../components/helpers');
const _ = require('lodash');
const moment = require('moment');
const config = require('../server/config');
const syncWorker = require('./workerRunner').sync;
const apiError = require('./apiError');
const WorkerRunner = require('./../components/workerRunner');
const uuid = require('uuid');

/**
 * Get backup password
 * @return {*}
 */
const getBackupPassword = function () {
  // read backup password from config
  let password = _.get(config, 'backUp.password');
  if (password) {
    // if present, hash it
    password = app.utils.helpers.sha256(password);
  }
  return password;
};

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
    models.sync.exportDatabase(
      null,
      collections,
      {
        password: getBackupPassword(),
        chunkSize: 10000,
        exportEmptyCollections: true,
        noDataFiltering: true
      },
      (exportError, archivePath) => {
        if (exportError) {
          app.logger.error('Backup process failed.', {error: exportError});
          return done(exportError);
        }

        // get file name from archive path
        let fileParse = path.parse(archivePath);
        let fileName = fileParse.name + fileParse.ext;

        // build new path for the backup file
        let newPath = path.join(location, fileName);

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
 */
const restoreBackup = function (
  backupId,
  restoreLogId,
  done
) {
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
      restoreBackupFromFile(
        backup.location,
        restoreLogId,
        (err) => done(err)
      );
    })
    .catch((err) => done(err));
};

/**
 * Restore a backup from file
 */
const restoreBackupFromFile = function (
  filePath,
  restoreLogId,
  done
) {
  // cache reference to mongodb connection
  let connection = app.dataSources.mongoDb.connector;

  // establish database connection before anything
  connection.connect((mongoDbConnError) => {
    if (mongoDbConnError) {
      app.logger.error('Failed to establish database connection');
      return done(mongoDbConnError);
    }

    const password = getBackupPassword();

    // handle restore log updates
    let updateRestoreLogStatusAtTheEnd = false;
    const updateRestoreLog = (data) => {
      // must initialize ?
      if (!restoreLogId) {
        restoreLogId = uuid.v4();
        updateRestoreLogStatusAtTheEnd = true;
        return connection.collection('databaseActionLog').insertOne({
          _id: restoreLogId,
          type: 'restore-db',
          actionStartDate: new Date(),
          status: 'LNG_SYNC_STATUS_IN_PROGRESS',
          statusStep: 'LNG_STATUS_STEP_PREPARING_RESTORE',
          totalNo: 0,
          processedNo: 0,
          deleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          dbUpdatedAt: new Date()
        });
      }

      // update
      return connection.collection('databaseActionLog').updateOne(
        {
          _id: restoreLogId
        }, {
          '$set': data
        }
      );
    };

    // initialize restore log if necessary
    return updateRestoreLog(
      {
        updatedAt: new Date(),
        dbUpdatedAt: new Date(),
      })
      .then(() => {
        const options = {
          password: password,
          prefix: 'restore_',
          restoreLogId
        };
        return syncWorker.extractAndDecryptSnapshotArchive(filePath, options)
          .then(function (result) {
            const collectionFilesDirName = result.collectionFilesDirName;
            const tmpDirName = result.tmpDirName;
            const restoreTotalSteps = result.restoreTotalSteps;

            return new Promise((resolve, reject) => {
              // read backup files in the temporary dir
              return fs.readdir(collectionFilesDirName, (err, filenames) => {
                if (err) {
                  return reject(err);
                }

                // filter files that match a collection name
                let collectionsFiles = filenames.filter((filename) => {
                  // split filename into 'collection name' and 'extension'
                  filename = filename.split('.');
                  return filename[0] && dbSync.collectionsMap.hasOwnProperty(filename[0]);
                });

                // sort collectionFiles by batch number
                collectionsFiles.sort(function (a, b) {
                  let aFileParts = a.split('.');
                  let bFileParts = b.split('.');
                  if (aFileParts[0] !== bFileParts[0]) {
                    // sort by collection name;
                    // Note: we are currently relying on the fact that alphabetical order is the correct order
                    return aFileParts[0] < bFileParts[0] ? -1 : 1;
                  } else {
                    // sort
                    return parseInt(aFileParts[1]) < parseInt(bFileParts[1]) ? -1 : 1;
                  }
                });

                // initialize collection started map; needed to only try and remove existing records once
                let collectionStartedMap = {};

                // start restoring the database using provided collection files
                return async.series(
                  collectionsFiles.map((fileName, fileIndex) => (doneCollection) => {
                    let filePath = `${collectionFilesDirName}/${fileName}`;
                    const processedNo = restoreTotalSteps ?
                      (restoreTotalSteps - collectionsFiles.length + fileIndex + 1) :
                      -1;

                    return fs.readFile(
                      filePath,
                      {
                        encoding: 'utf8'
                      },
                      (err, data) => {
                        if (err) {
                          app.logger.error(`Failed to read collection file ${filePath}`);
                          return doneCollection(apiError.getError('FILE_NOT_FOUND'));
                        }

                        // split filename into 'collection name' and 'extension'
                        let fileNameSplit = fileName.split('.');
                        let collectionName = fileNameSplit[0];

                        app.logger.debug(`Restoring Collection '${collectionName}' batch ${fileNameSplit[1]}...`);

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
                            // bulk insert records
                            const insertRecords = function () {
                              // if there are no records in the files just
                              // skip it
                              if (!collectionRecords.length) {
                                app.logger.debug(`Collection ${collectionName} has no records in the file. Skipping it`);
                                updateRestoreLog({
                                  updatedAt: new Date(),
                                  dbUpdatedAt: new Date(),
                                  processedNo
                                }).then(() => {
                                  // remove collection json file
                                  fs.unlinkSync(filePath);
                                }).then(() => {
                                  doneCollection();
                                }).catch(doneCollection);
                                return;
                              }

                              // create a bulk operation
                              const bulk = collectionRef.initializeOrderedBulkOp();

                              // insert all entries from the file in the collection
                              collectionRecords.forEach((record) => {
                                // consider that each record was inserted now
                                record.dbUpdatedAt = new Date();

                                // insert record
                                bulk.insert(record);
                              });

                              // execute the bulk operations
                              bulk.execute((err) => {
                                if (err) {
                                  app.logger.error(`Failed to insert records for collection ${collectionName}`);
                                  // stop at once, if any error has occurred
                                  return doneCollection(err);
                                }
                                app.logger.debug(`Restoring Collection ${collectionName} complete.`);
                                updateRestoreLog({
                                  updatedAt: new Date(),
                                  dbUpdatedAt: new Date(),
                                  processedNo
                                }).then(() => {
                                  // remove collection json file
                                  fs.unlinkSync(filePath);
                                }).then(() => {
                                  doneCollection();
                                }).catch(doneCollection);
                                return;
                              });
                            };

                            // check if collection restore already started
                            // removing existing records only if the collection restore didn't already start
                            if (!collectionStartedMap[collectionName]) {
                              // update collection started flag
                              collectionStartedMap[collectionName] = true;

                              // remove all the documents from the collection, then bulk insert the ones from the file
                              collectionRef.deleteMany({}, (err) => {
                                // if delete fails, don't continue
                                if (err) {
                                  app.logger.error(`Failed to delete database records of collection: ${collectionName}`);
                                  return doneCollection(err);
                                }

                                // insert records
                                insertRecords();
                              });
                            } else {
                              // no need to remove documents; just insert
                              insertRecords();
                            }
                          };

                          // copy collection linked files
                          if (dbSync.collectionsWithFiles.hasOwnProperty(collectionName)) {
                            dbSync.importCollectionRelatedFiles(collectionName, tmpDirName, app.logger, options.password, (err) => {
                              if (err) {
                                return doneCollection(err);
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
                  (err) => err ? reject(err) : resolve()
                );
              });
            });
          });
      })
      .catch(err => {
        app.logger.error('Restoring backup failed', {err: err.toString ? err.toString() : JSON.stringify(err)});
        return Promise.reject(apiError.getError('RESTORE_BACKUP_FAILED'));
      })
      .then(() => {
        return updateRestoreLog({
          statusStep: 'LNG_STATUS_STEP_MIGRATING_DATABASE',
          updatedAt: new Date(),
          dbUpdatedAt: new Date()
        });
      })
      .then(() => {
        app.logger.debug('Restoring backup finished successfully');
        // run migrations
        return WorkerRunner.installScripts.migrateDatabase()
          .catch(err => {
            app.logger.error('Database migration failed', {err});
            return Promise.reject(apiError.getError('MIGRATE_DATABASE_FAILED'));
          });
      })
      .then(() => {
        // nothing to do ?
        if (!updateRestoreLogStatusAtTheEnd) {
          return;
        }

        // update status
        return updateRestoreLog({
          status: 'LNG_SYNC_STATUS_SUCCESS',
          statusStep: 'LNG_STATUS_STEP_RESTORE_FINISHED',
          updatedAt: new Date(),
          dbUpdatedAt: new Date(),
          actionCompletionDate: new Date()
        });
      })
      .then(() => {
        // invalidate caches
        app.models.location.cache.reset();
        app.models.user.cache.reset();

        done();
      })
      .catch(done);
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
            return done(apiError.getError('FILE_NOT_FOUND'));
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
 * @param filter Filter for the resources that need to be removed
 */
const removeBackups = function (filter = {}) {
  const backupModel = app.models.backup;

  // retrieve all backups that are older
  backupModel
    .find(filter)
    .then((olderBackups) => olderBackups.forEach((backup) => removeBackup(backup, () => {
    })));
};

/**
 * Retrieve system settings get backup timings, check backup location
 * Used mainly for backup routines (create, cleanup)
 * @parma done
 */
const preRoutine = function (done) {
  // retrieve system settings and get backup timings
  app.models.systemSettings
    .findOne()
    .then((systemSettings) => {

      // do not perform any additional checks if the automatic backup is off
      if (systemSettings.dataBackup && systemSettings.dataBackup.disabled) {
        return done(null, systemSettings.dataBackup);
      }

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
