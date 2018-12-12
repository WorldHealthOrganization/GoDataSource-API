'use strict';

const MongoClient = require('mongodb').MongoClient;
const async = require('async');
const tmp = require('tmp');
const archiver = require('archiver');
const fs = require('fs');
const Moment = require('moment');
const path = require('path');
const AdmZip = require('adm-zip');

const logger = require('./../logger');
const dbSync = require('./../dbSync');
const workerRunner = require('./../workerRunner');
const dbConfig = require('./../../server/datasources').mongoDb;

/**
 * Create ZIP archive of a file/dir
 * @param fileName
 * @param archiveName
 * @param logger
 * @returns {Promise<any>}
 */
function createZipArchive(fileName, archiveName, logger) {
  return new Promise(function (resolve, reject) {
    // compress all collection files from the tmp dir into .zip file
    logger.debug('Creating zip file');
    let output = fs.createWriteStream(archiveName);
    let archive = archiver('zip');

    // listen for all archive data to be written
    // 'close' event is fired only when a file descriptor is involved
    output.on('close', function () {
      // log archive name location
      logger.debug(`Archive created at '${archiveName}'. Size: ${archive.pointer()} bytes'`);
      resolve(archiveName);
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on('warning', function (err) {
      logger.debug('Archive warning' + err);
    });

    // good practice to catch this error explicitly
    archive.on('error', function (err) {
      logger.debug('Archive error' + err);
      reject(err);
    });

    // pipe archive data to the file
    archive.pipe(output);

    if (fs.statSync(fileName).isDirectory()) {
      // append files from a sub-directory, putting its contents at the root of archive
      archive.directory(fileName, false);
    } else {
      // archive given file
      archive.file(fileName, {name: path.basename(fileName)});
    }

    // finalize the archive (ie we are done appending files but streams have to finish yet)
    archive.finalize();
  });
}

/**
 * Create MongoDB connection and return it
 * @returns {Promise<Db | never>}
 */
function getMongoDBConnection() {
  let mongoOptions = {};
  if (dbConfig.password) {
    mongoOptions = {
      auth: {
        user: dbConfig.user,
        password: dbConfig.password
      },
      authSource: dbConfig.authSource
    };
  }
  return MongoClient
    .connect(`mongodb://${dbConfig.host}:${dbConfig.port}`, mongoOptions)
    .then(function (client) {
      return client
        .db(dbConfig.database);
    });
}

/**
 * Export a collection in batches
 * @param dbConnection
 * @param mongoCollectionName
 * @param collectionName
 * @param filter
 * @param batchSize
 * @param tmpDirName
 * @param archivesDirName
 * @param options
 * @param callback
 * @returns {Promise<any>}
 */
function exportCollectionInBatches(dbConnection, mongoCollectionName, collectionName, filter, batchSize, tmpDirName, archivesDirName, options, callback) {
  /**
   * Get next batch from collection
   * @param skip
   */
  function getNextBatch(skip = 0) {
    let batchNumber = skip ? skip / batchSize : 0;

    let cursor = dbConnection
      .collection(mongoCollectionName)
      .find(filter, {
        skip: skip,
        limit: batchSize
      });

    // retrieve
    cursor
      .toArray()
      .then(function (records) {
        // check if records were returned; consider collection finished if no records
        if (!records || !records.length) {
          logger.debug(`Collection '${collectionName}' export success.`);
          return callback();
        }

        // export related files
        // if collection is not supported, it will be skipped
        dbSync.exportCollectionRelatedFiles(collectionName, records, archivesDirName, logger, options.password, (err) => {
          if (err) {
            logger.debug(`Collection '${collectionName}' related files export failed. Error: ${err}`);
            return callback(err);
          }

          let fileName = `${collectionName}.${batchNumber}.json`;
          let filePath = `${tmpDirName}/${fileName}`;

          // create a file with collection name as file name, containing results
          fs.writeFile(filePath, JSON.stringify(records, null, 2), function () {
            // archive file
            let archiveFileName = `${archivesDirName}/${fileName}.zip`;
            createZipArchive(filePath, archiveFileName, logger)
              .then(function () {
                // encrypt archived file if needed
                if (options.password) {
                  // password provided, encrypt archive
                  logger.debug(`Encrypting '${archiveFileName}'.`);
                  return workerRunner
                    .helpers
                    .encryptFile(options.password, {}, archiveFileName);
                } else {
                  // no password provided, return file path as is
                  return Promise.resolve();
                }
              })
              .then(function () {
                if (records.length < batchSize) {
                  // finish
                  logger.debug(`Collection '${collectionName}' export success.`);
                  return callback();
                } else {
                  // continue with next batch
                  logger.debug(`Exported batch ${batchNumber} of collection '${collectionName}'.`);
                  return getNextBatch(skip + batchSize);
                }
              })
              .catch(function (err) {
                logger.debug(`Failed to export batch ${batchNumber} of collection '${collectionName}': ${err}`);
                return callback(err);
              });
          });
        });
      })
      .catch(function (err) {
        logger.debug(`Collection '${collectionName}' export failed. Error: ${err}`);
        return callback(err);
      });
  }

  // start collection export
  getNextBatch();
}

const worker = {
  /**
   * Export collections and create ZIP file
   * @param collections
   * @param options Includes customFilter, filter, password
   * @returns {Promise<any | never>}
   */
  exportCollections: function (collections, options) {
    // initialize mongodb connection
    return getMongoDBConnection()
      .then(function (dbConnection) {
        return new Promise(function (resolve, reject) {
          let tmpDir, tmpDirName, archivesDirName;

          try {
            // create a temporary directory to store the database files
            // it always created the folder in the system temporary directory
            tmpDir = tmp.dirSync();
            tmpDirName = tmpDir.name;
            // also create an archives subdir
            archivesDirName = `${tmpDirName}/archives`;
            fs.mkdirSync(archivesDirName);
          } catch (err) {
            logger.debug(`Failed creating tmp directories; ${err}`);
            return reject(err);
          }

          let customFilter = options.customFilter;
          let filter = options.filter;

          async
            .series(
              Object.keys(collections).map((collectionName) => {
                return (callback) => {
                  // get mongoDB filter that will be sent; for some collections we might send additional filters
                  let mongoDBFilter = dbSync.collectionsFilterMap[collectionName] ? dbSync.collectionsFilterMap[collectionName](collectionName, customFilter, filter) : customFilter;

                  logger.debug(`Exporting collection: ${collectionName}`);

                  // export collection
                  exportCollectionInBatches(dbConnection, collections[collectionName], collectionName, mongoDBFilter, 1000, tmpDirName, archivesDirName, options, callback);
                };
              }),
              (err) => {
                if (err) {
                  return reject(err);
                }

                // archive file name
                let archiveName = `${tmpDirName}/../snapshot_${Moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;

                createZipArchive(archivesDirName, archiveName, logger)
                  .then(resolve)
                  .catch(reject);
              }
            );
        });
      });
  },

  /**
   * Extract and Decrypt Snapshot archive
   * @param snapshotFile
   * @param options
   * @returns {Promise<any>}
   */
  extractAndDecryptSnapshotArchive: function (snapshotFile, options) {
    return new Promise(function (resolve, reject) {
      let tmpDir, tmpDirName, collectionFilesDirName;

      try {
        logger.debug('Creating tmp directories');
        // create a temporary directory to store the database files
        // it always created the folder in the system temporary directory
        tmpDir = tmp.dirSync({unsafeCleanup: true});
        tmpDirName = tmpDir.name;
        // also create an archives subdir
        collectionFilesDirName = `${tmpDirName}/collections`;
        fs.mkdirSync(collectionFilesDirName);
      } catch (err) {
        logger.error(`Failed creating tmp directories; ${err}`);
        return reject(err);
      }

      // extract snapshot
      try {
        logger.debug(`Extracting zip archive: ${snapshotFile}`);
        let archive = new AdmZip(snapshotFile);
        archive.extractAllTo(tmpDirName);
      } catch (zipError) {
        logger.error(`Failed to extract zip archive: ${snapshotFile}. ${zipError}`);
        return reject(typeof zipError === 'string' ? {message: zipError} : zipError);
      }

      // decrypt all collection files archives if needed
      let collectionArchives;
      try {
        // get only zip files
        collectionArchives = fs.readdirSync(tmpDirName);
        collectionArchives = collectionArchives.filter(function (fileName) {
          return !fs.statSync(`${tmpDirName}/${fileName}`).isDirectory() && path.extname(fileName) === '.zip';
        });
      } catch (err) {
        logger.error(`Failed to read collection archive files at : ${tmpDirName}. ${err}`);
        return reject(err);
      }

      // define archive decryption action
      let decryptArchives;
      // if no password was provided
      if (!options.password) {
        // nothing to do, return file path as is
        decryptArchives = Promise.resolve(collectionArchives);
      } else {
        // password provided, decrypt archives
        let decryptFunctions = collectionArchives.map(function (filePath) {
          return function (callback) {
            workerRunner
              .helpers
              .decryptFile(options.password, {}, `${tmpDirName}/${filePath}`)
              .then(function () {
                callback();
              })
              .catch(callback);
          };
        });

        decryptArchives = new Promise(function (resolve, reject) {
          logger.debug(`Decripting archives from: ${tmpDirName}`);
          async.parallelLimit(decryptFunctions, 5, function (err) {
            if (err) {
              logger.error(`Failed to decrypt archive files from : ${tmpDirName}. ${err}`);
              return reject(err);
            }
            return resolve();
          });
        });
      }

      decryptArchives
        .then(function () {
          // extract collection archives
          try {
            logger.debug(`Extracting archives from: ${tmpDirName}`);
            collectionArchives.forEach(function (filePath) {
              let archive = new AdmZip(`${tmpDirName}/${filePath}`);
              archive.extractAllTo(collectionFilesDirName);
            });
          } catch (zipError) {
            logger.error(`Failed to extract collection archives at: ${tmpDirName}. ${zipError}`);
            return reject(typeof zipError === 'string' ? {message: zipError} : zipError);
          }
          // collection files were decrypted and extracted; return collection files container directory
          return resolve({
            collectionFilesDirName: collectionFilesDirName,
            tmpDirName: tmpDirName
          });
        })
        .catch(reject);
    });
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args)
    .then(function (result) {
      process.send([null, result]);
    })
    .catch(function (error) {
      process.send([error]);
    });
});

