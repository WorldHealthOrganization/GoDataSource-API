'use strict';

const MongoClient = require('mongodb').MongoClient;
const async = require('async');
const tmp = require('tmp');
const archiver = require('archiver');

const logger = console;//require('./../logger');
const dbSync = require('../dbSync');
const dbConfig = require('./../../server/datasources').mongoDb;

/**
 * Create MongoDB connection and return it
 * @returns {Promise<Db | never>}
 */
function getMongoDBConnection() {
  logger.info('aaaaaa');
  return MongoClient
    .connect(`${dbConfig.host}:${dbConfig.port}`, {
      auth: {
        user: dbConfig.user,
        password: dbConfig.password
      }
    })
    .then(function (client) {
      logger.info('bbbbb');
      return client
        .db(dbConfig.database)
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
 * @param callback
 * @returns {Promise<any>}
 */
function exportCollectionInBatches(dbConnection, mongoCollectionName, collectionName, filter, batchSize, tmpDirName, callback) {
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
        if (records && records.length) {
          // export related files
          // if collection is not supported, it will be skipped
          dbSync.exportCollectionRelatedFiles(collectionName, records, tmpDirName, logger, (err) => {
            if (err) {
              logger.debug(`Collection '${collectionName}' related files export failed. Error: ${err}`);
              return callback(err);
            }
            // create a file with collection name as file name, containing results
            fs.writeFile(`${tmpDirName}/${collectionName}.${batchNumber}.json`, JSON.stringify(records, null, 2), function () {
              if (records.length < batchSize) {
                logger.debug(`Collection '${collectionName}' export success.`);
                return callback();
                // finish
              } else {
                logger.debug(`Exported batch ${batchNumber} of collection '${collectionName}'.`);
                getNextBatch(skip + batchSize);
              }
            });
          });
        } else {
          logger.debug(`Collection '${collectionName}' export success.`);
          callback();
        }
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
   * @param customFilter
   * @param filter
   * @returns {Promise<any | never>}
   */
  exportCollections: function (collections, customFilter, filter) {
    // initialize mongodb connection
    return getMongoDBConnection()
      .then(function (dbConnection) {
        return new Promise(function (resolve, reject) {
          // create a temporary directory to store the database files
          // it always created the folder in the system temporary directory
          let tmpDir = tmp.dirSync();
          let tmpDirName = tmpDir.name;

          async
            .series(
              Object.keys(collections).map((collectionName) => {
                return (callback) => {
                  // get mongoDB filter that will be sent; for some collections we might send additional filters
                  let mongoDBFilter = dbSync.collectionsFilterMap[collectionName] ? dbSync.collectionsFilterMap[collectionName](collectionName, customFilter, filter) : customFilter;

                  logger.debug(`Exporting collection: ${collectionName}`);

                  // export collection
                  exportCollectionInBatches(dbConnection, collections[collectionName], collectionName, mongoDBFilter, 1000, tmpDirName, callback);
                };
              }),
              (err) => {
                if (err) {
                  return reject(err);
                }

                // archive file name
                let archiveName = `${tmpDirName}/../snapshot_${Moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;

                // compress all collection files from the tmp dir into .zip file
                logger.debug(`Creating zip file`);
                let output = fs.createWriteStream(archiveName);
                let archive = archiver('zip');

                // listen for all archive data to be written
                // 'close' event is fired only when a file descriptor is involved
                output.on('close', function () {
                  logger.debug(archive.pointer() + ' total bytes');
                  logger.debug('archiver has been finalized and the output file descriptor has closed.');
                  // log archive name location
                  logger.debug(`Sync payload created at ${archiveName}`);
                  resolve();
                });

                // This event is fired when the data source is drained no matter what was the data source.
                // It is not part of this library but rather from the NodeJS Stream API.
                // @see: https://nodejs.org/api/stream.html#stream_event_end
                output.on('end', function () {
                  logger.debug('Data has been drained');
                  reject('err');
                });

                // good practice to catch warnings (ie stat failures and other non-blocking errors)
                archive.on('warning', function (err) {
                  logger.debug('Archive warning' + err);
                  if (err.code === 'ENOENT') {
                    // log warning
                  } else {
                  }
                });

                // good practice to catch this error explicitly
                archive.on('error', function (err) {
                  logger.debug('Archive error' + err);
                  reject('err');
                });

                // pipe archive data to the file
                archive.pipe(output);

                // append files from a sub-directory, putting its contents at the root of archive
                archive.directory(tmpDirName, false);


                // finalize the archive (ie we are done appending files but streams have to finish yet)
                // 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
                archive.finalize();

                // // no password provided, return file path as is
                // if (!options.password) {
                //   return done(null, archiveName);
                // }
                // // password provided, encrypt archive
                // return app.utils.fileCrypto
                //   .encrypt(options.password, {}, archiveName)
                //   .then(function (archiveName) {
                //     return done(null, archiveName);
                //   })
                //   .catch(done);
              }
            );
        });
      });
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args)
    .then(function () {
      process.send([null, true]);
    })
    .catch(function (error) {
      process.send([error]);
    });
});

