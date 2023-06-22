'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Add deleted property to all models that are missing the property
 */
const addMissingDeletedProperty = (callback) => {
  // get db connection
  let dbConnection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      // retrieve all collections
      dbConnection = dbConn;
      return dbConnection
        .listCollections()
        .toArray();
    })
    .then((collectionsToHandle) => {
      // go through each collection and determine if we have records with missing deleted properties
      const nextCollection = () => {
        // no more collections ?
        if (collectionsToHandle.length < 1) {
          // finished
          return callback();
        }

        // get next collections
        const collectionName = collectionsToHandle.splice(0, 1)[0].name;

        // ignore system indexes
        if (collectionName.toLowerCase().indexOf('system.indexes') > -1) {
          // log
          console.log(`'${collectionName}' is a reserved collection`);

          // next collection
          nextCollection();

          // finished
          return;
        }

        // log
        console.log(`Checking if '${collectionName}' has records without deleted property`);

        // determine if we have records without deleted property
        const missingDeletedPropertyQuery = {
          deleted: {
            $nin: [
              true,
              false
            ]
          }
        };
        const collection = dbConnection.collection(collectionName);
        collection
          .countDocuments(
            missingDeletedPropertyQuery, {
              limit: 1
            }
          )
          .then((counted) => {
            // does our collection have records without deleted property ?
            if (counted < 1) {
              // log
              console.log(`All records of '${collectionName}' have deleted property`);

              // next collection
              nextCollection();
            } else {
              // log
              console.log(`Collection '${collectionName}' has records without deleted property. Starting to update records`);

              // update in batches
              collection
                .updateMany(
                  missingDeletedPropertyQuery, {
                    $set: {
                      deleted: false
                    }
                  }
                )
                .then((result) => {
                  // log
                  console.log(`Collection '${collectionName}' finished updating (matched: ${result.matchedCount}, modified: ${result.modifiedCount})`);

                  // next collection
                  nextCollection();
                })
                .catch(callback);
            }
          })
          .catch(callback);
      };

      // start going through models
      nextCollection();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  addMissingDeletedProperty
};
