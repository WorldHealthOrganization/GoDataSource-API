'use strict';

const tar = require('tar');
const tmp = require('tmp');
const async = require('async');
const app = require('../../server/server');
const fs = require('fs');

module.exports = function (Sync) {
  Sync.hasController = true;

  // map of collections and their given corresponding collection name in database
  let collectionsMap = {
    systemSettings: 'systemSettings',
    template: 'template',
    icon: 'icon',
    helpCategory: 'helpCategory',
    language: 'language',
    languageToken: 'languageToken',
    outbreak: 'outbreak',
    person: 'person',
    labResult: 'labResult',
    followUp: 'followUp',
    referenceData: 'referenceData',
    relationship: 'relationship',
    location: 'location',
    team: 'team',
    user: 'user',
    role: 'role',
    cluster: 'cluster'
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
   * @param excludes
   * @param collectionsOpts
   * @param done
   */
  Sync.exportDatabase = function (filter = { where: {} }, excludes = [], collectionsOpts = [], done) {
    // defensive checks
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
        where: {
          updatedAt: {
            $gte: filter.where.fromDate
          }
        }
      };
    }

    // create a copy of the collections map and exclude the ones from the list of excludes (if any)
    let collections = Object.assign({}, collectionsMap);
    Object.keys(collections).forEach((collectionName) => {
      if (excludes.indexOf(collectionName) !== -1) {
        delete collections[collectionName];
      }
    });

    // create a temporary directory to store the database files
    // it always created the folder in the system temporary directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;

    return async
      .series(
        Object.keys(collections).map((collectionName) => {
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
              .collection(collections[collectionName])
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
          let archiveName = `${tmpDirName}/db_snapshot_${Date.now()}.tar.gz`;

          // retrieve all files in the temporary directory
          return fs.readdir(tmpDirName, function (err, filenames) {
            if (err) {
              return done(err);
            }

            // compress all collection files from the tmp dir into .tar file
            tar
              .c(
                {
                  gzip: true,
                  file: archiveName,
                  cwd: tmpDirName
                },
                filenames
              )
              .then(() => done(null, archiveName));
          });
        }
      );
  };

  /**
   * Extract a database snapshot archive to a temporary directory
   * @param filePath
   * @param callback
   */
  Sync.extractDatabaseArchive = function (filePath, callback) {
    // create a temporary directory to store the database files
    // it always created the folder in the system temporary directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;

    // cache reference to mongodb connection
    let connection = app.dataSources.mongoDb.connector;

    // create a tar extract stream
    tar.x(
      {
        cwd: tmpDirName,
        file: filePath
      },
      (err) => {
        if (err) {
          return callback(err);
        }

        // retrieve all the extracted files
        return fs.readdir(tmpDirName, function (err, filenames) {
          if (err) {
            return callback(err);
          }

          // filter files that match a collection name
          let collectionsFiles = filenames.filter((filename) => {
            // split filename into 'collection name' and 'extension'
            filename = filename.split('.');
            return collectionsMap.hasOwnProperty(filename[0]);
          });

          // read each file's contents and sync with database
          return async.parallel(collectionsFiles.map((fileName) => {
            return (done) => {
              // split filename into 'collection name' and 'extension'
              let collectionName = fileName.split('.');

              // cache reference to Loopback's model
              let model = app.models[collectionsMap[collectionName]];

              fs.readFile(`${tmpDirName}/${fileName}`, (err, data) => {
                // parse file contents to JavaScript object
                try {
                  let collectionRecords = JSON.parse(data);

                  return async.parallel(
                    collectionRecords.map((collectionRecord) => {
                      return (done) => {
                        // check if a record with the given id exists
                        // if not, create it, otherwise check updatedAt timestamp
                        // if it's different, then update the record using data from the snapshot
                        model.findById(collectionRecord._id, (err, record) => {
                            if (err) {
                              return done(err);
                            }

                            if (!record) {
                              return model.save(collectionRecord, done);
                            }

                            if (record && record.updatedAt !== collectionRecord.updatedAt) {
                              return model.updateAttributes(collectionRecord, done);
                            }

                            return done();
                          });
                      };
                    }),
                    (err) => callback(err)
                  );
                } catch (parseError) {
                  return done(parseError);
                }
              });
            };
          }));
        });
      }
    );
  }
};
