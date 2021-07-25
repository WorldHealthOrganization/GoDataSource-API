'use strict';

const app = require('../../server/server');
const MongoDBHelper = require('./../../components/mongoDBHelper');
const exportHelper = require('./../../components/exportHelper');

module.exports = function (ExportLog) {
  // set flag to get controller
  ExportLog.hasController = true;

  // after the application started (all models finished loading)
  app.on('started', function () {

    // status update is handled by DatabaseActionLog, we need to handle the rest
    // - delete remaining files
    // - delete temporary databases
    return MongoDBHelper
      .getMongoDBConnection()
      .then((dbConn) => {
        // retrieve all collections
        return dbConn
          .listCollections()
          .toArray()
          .then((collections) => {
            return {
              collections,
              dbConn
            };
          });
      })
      .then((data) => {
        // go through each collection and determine if we have records with missing deleted properties
        const nextCollection = () => {
          // no more collections ?
          if (data.collections.length < 1) {
            // finished
            return Promise.resolve();
          }

          // get next collections
          const collection = data.collections.splice(0, 1)[0];

          // not interested in doing stuff to this collection ?
          if (
            !exportHelper.TEMPORARY_DATABASE_PREFIX ||
            !collection.name.startsWith(exportHelper.TEMPORARY_DATABASE_PREFIX)
          ) {
            return nextCollection();
          }

          // log
          console.log(`'${collection.name}' is a temporary collection. Dropping collection`);

          // drop collection and jump to next collection
          return data.dbConn.collection(collection.name)
            .drop()
            .then(() => {
              // log
              console.log(`'${collection.name}' dropped`);
            })
            .then(nextCollection);
        };

        // start going through collections
        return nextCollection();
      });
  });
};
