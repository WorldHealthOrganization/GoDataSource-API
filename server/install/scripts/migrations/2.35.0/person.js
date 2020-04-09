'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Async = require('async');

// Note: we cannot set batchSize to more than ~27000 as in case all relationships participants are different
// we would make a query in MongoDB with more than ~54000 person IDs which would exceed 16MB limit
const relationshipsFindBatchSize = 1000;

// set how many person update actions to run in parallel
const personsUpdateBatchSize = 10;

/**
 * Set hasRelationships flag as true on all persons which have relationships
 * Retrieve relationships in batches and set hasRelationships flag for participants
 * @param callback
 */
const setHasRelationshipsFlag = (callback) => {
  let relationshipsCollection, personCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      relationshipsCollection = dbConn.collection('relationship');
      personCollection = dbConn.collection('person');

      // count not deleted relationships
      return relationshipsCollection
        .countDocuments({
          deleted: {
            $ne: true
          }
        });
    })
    .then(relationshipsCount => {
      if (relationshipsCount === 0) {
        // nothing to do
        console.log('No relationships found for which to update participants.');
        return Promise.resolve();
      }

      /**
       * Handle relationships in batches
       * @param batchNo
       * @return {PromiseLike<T | never>}
       */
      const handleRelationshipsInBatches = (batchNo = 1) => {
        console.log(`Processing relationships batch ${batchNo}`);

        // initialize map for persons with relationships
        let personsWithRelationshipsMap = {};
        let personsWithRelationshipsIds = [];

        // get relationships for batch
        return relationshipsCollection
          .find({
            deleted: {
              $ne: true
            }
          }, {
            skip: (batchNo - 1) * relationshipsFindBatchSize,
            limit: relationshipsFindBatchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              persons: 1
            }
          })
          .toArray()
          .then(relationships => {
            // loop through the found relationships and fill the persons with relationships maps
            relationships.forEach(relationship => {
              relationship.persons.forEach(person => {
                if (!personsWithRelationshipsMap[person.id]) {
                  // add an ID in list only if it was not already added
                  personsWithRelationshipsIds.push(person.id);

                  // initialize map entry
                  personsWithRelationshipsMap[person.id] = [];
                }

                // add new entry in map
                personsWithRelationshipsMap[person.id].push(relationship._id);
              });
            });

            // set hasRelationships flag to all persons at once
            // however we cannot set relationshipsIds array for all persons at once so we will set it one by one
            return personCollection
              .updateMany({
                _id: {
                  $in: personsWithRelationshipsIds
                }
              }, {
                '$set': {
                  hasRelationships: true,
                  // reset relationshipsIds array; we don't want any old information as we will set it again anyway
                  relationshipsIds: []
                }
              });
          })
          .then(() => {
            // set relationships array for all found persons in this batch
            // hasRelationships flag was already set
            let updatePersonsJobs = personsWithRelationshipsIds.map(personId => {
              return (cb) => {
                return personCollection
                  .updateOne({
                    _id: personId
                  }, {
                    '$addToSet': {
                      relationshipsIds: {
                        '$each': personsWithRelationshipsMap[personId]
                      }
                    }
                  })
                  .then(() => {
                    return cb();
                  })
                  .catch(cb);
              };
            });

            return new Promise((resolve, reject) => {
              Async.parallelLimit(updatePersonsJobs, personsUpdateBatchSize, (err) => {
                if (err) {
                  return reject(err);
                }

                return resolve();
              });
            });
          })
          .then(() => {
            console.log(`Finished processing batch ${batchNo}`);
            // persons for relationships batch were updated
            // check if we need to handle another batch
            if (batchNo * relationshipsFindBatchSize > relationshipsCount) {
              console.log('All relationships have been processed');
              // finished processing
              return Promise.resolve();
            } else {
              // relationships handled are less than the total number; continue with next batch
              return handleRelationshipsInBatches(++batchNo);
            }
          });
      };

      // start batches processing
      return handleRelationshipsInBatches();
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  setHasRelationshipsFlag
};
