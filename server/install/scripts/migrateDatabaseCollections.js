'use strict';

/**
 * Migrate Database. WARNING - this should be run only after the collections are created as it only update what changed
 */
const app = require('../../server');
const _ = require('lodash');

const migrations = [];
let connected = false;

// keep list of collections
let collectionsMap;

/**
 * Set up collections
 */
app.models().forEach(function (Model) {
  const dataSource = Model.dataSource;
  if (dataSource && Model.modelName.match(/^[a-z]/)) {
    // determine existing list of collections
    if (collectionsMap === undefined) {
      collectionsMap = {};
      migrations.push(function determineCollections(callback) {
        // determine collections
        const mapCollections = () => {
          return Model.dataSource.connector.db
            .listCollections()
            .toArray()
            .then((collections) => {
              (collections || []).forEach((collectionInfo) => {
                collectionsMap[collectionInfo.name] = collectionInfo;
              });
            });
        };

        // do we need to establish db connection ?
        if (!connected) {
          dataSource.connect(function () {
            mapCollections()
              .then(callback)
              .catch(callback);
          });
        } else {
          mapCollections()
            .then(callback)
            .catch(callback);
        }
      });
    }

    // construct list of items that we need to migrate
    migrations.push(function migrate(callback) {
      // remove index handler
      const removeIndex = function (modelHandler) {
        // if collection name was not defined in settings
        let collectionName = _.get(modelHandler, 'definition.settings.mongodb.collection');
        if (!collectionName) {
          // get it from model name
          collectionName = modelHandler.modelName;
        }

        // do we need to do anything here ?
        if (
          !collectionsMap ||
          !collectionsMap[collectionName] ||
          !modelHandler.settings ||
          !modelHandler.settings.removeIndexes ||
          !modelHandler.settings.removeIndexes.length
        ) {
          return Promise.resolve();
        }

        // return promise that handles index drop
        return new Promise(function (resolve, reject) {
          // remove indexes
          console.log(`Removing indexes for ${modelHandler.modelName}...`);

          // generate list of promises that drop indexes if they exists
          const promiseList = [];
          modelHandler.settings.removeIndexes.forEach((indexName) => {
            // check
            promiseList.push(
              modelHandler.dataSource.connector.db.collection(collectionName)
                .indexExists(indexName)
                .then((foundIndex) => {
                  // nothing to do ?
                  if (!foundIndex) {
                    console.log(`Index '${indexName}' from ${modelHandler.modelName} was already removed`);
                    return;
                  }

                  // remove index
                  console.log(`Removing index '${indexName}' for ${modelHandler.modelName}`);
                  return modelHandler.dataSource.connector.db.collection(collectionName)
                    .dropIndex(indexName)
                    .then(() => {
                      console.log(`Finished removing index '${indexName}' for ${modelHandler.modelName}`);
                    });
                })
            );
          });

          // execute all promises
          return Promise
            .all(promiseList)
            .then(() => {
              // finished
              console.log(`Finished removing indexes for ${modelHandler.modelName}...`);

              // finished
              resolve();
            })
            .catch(reject);
        });
      };

      // remove index
      if (!connected) {
        dataSource.connect(function () {
          // do we need to remove indexes first ?
          removeIndex(Model).then(() => {
            // migrate indexes
            console.log(`Migrating ${Model.modelName}...`);
            dataSource.autoupdate(Model.modelName, callback);
          });
        });
      } else {
        // do we need to remove indexes first ?
        removeIndex(Model).then(() => {
          // migrate indexes
          console.log(`Migrating ${Model.modelName}...`);
          dataSource.autoupdate(Model.modelName, callback);
        });
      }
    });
  }
});

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  if (migrations.length) {
    const migration = migrations.shift();
    migration(function (error) {
      if (error) {
        return callback(error);
      }
      run(callback);
    });
  } else {
    console.log('Migration complete.');
    callback();
  }
}

module.exports = run;
