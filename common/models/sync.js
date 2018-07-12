'use strict';

const zlib = require('zlib');
const tmp = require('tmp');
const async = require('async');
const app = require('../../server/server');

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
   * You may choose which collections should be excluded
   * It supports a custom filter { fromDate: Date } to only retrieve records past a given date
   * It also supports a flag that indicates whether the contents should be compressed
   * It exports each collection and stores it in a file, to not kill the RAM
   * @param filter
   * @param excludes
   * @param done
   */
  Sync.exportDatabase = function (filter = { where: {} }, excludes = [], done) {
    // cache reference to mongodb connection
    let connection = app.dataSources.mongoDb.connector;

    // parse from date filter
    let customFilter = { where: {}};
    if (filter.where.hasOwnProperty('fromDate')) {
      // doing this because createdAt and updatedAt are equal when a record is created
      customFilter.where.updatedAt = { $gte: filter.where.fromDate };
    }

    // create a copy of the collections map and exclude the ones from the list of excludes (if any)
    let collections = Object.assign({}, collectionsMap);
    Object.keys(collections).forEach((collectionName) => {
      if (excludes.indexOf(collectionName)) {
        collections[collectionName] = null;
      }
    });

    // create a temporary directory to store the database files and compressed dump
    let dirName = tmp.tmpNameSync();

    return async
      .series(
        Object.keys(collections).map((collectionName) => {
          return (callback) => {
            return connection
              .collection(collections[collectionName])
              .find(customFilter, (err, results) => {
                if (err) {
                  return callback(err);
                }

                // create a file with collection name as file name, containing results

              });
          };
        }),
        (err) => {
          if (err) {
            return done(err);
          }
          // compress all collection files

          return done();
        }
      );
  };
};
