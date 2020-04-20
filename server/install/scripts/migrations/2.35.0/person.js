'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// Note: we cannot set batchSize to more than ~27000 as in case all relationships participants are different
// we would make a query in MongoDB with more than ~54000 person IDs which would exceed 16MB limit
const relationshipsFindBatchSize = 1000;

// set how many person update actions to run in parallel
const personsUpdateBatchSize = 10;

/**
 * Set hasRelationships flag as true on all persons which have relationships
 * Retrieve relationships in batches and set hasRelationships flag for participants
 * @param [options] Optional
 * @param [options.outbreakName] Outbreak for which to update required information
 * @param callback
 */
const setRelationshipsInformationOnPerson = (options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  let outbreakCollection, relationshipsCollection, personCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');
      relationshipsCollection = dbConn.collection('relationship');
      personCollection = dbConn.collection('person');

      // initialize relationships filter
      let relationshipsFilter = {
        deleted: {
          $ne: true
        }
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // depending on given options we might just want to update persons on a given outbreak
        let getOutbreakId = Promise.resolve();
        if (options.outbreakName && options.outbreakName.length) {
          getOutbreakId = outbreakCollection
            .findOne({
              name: options.outbreakName
            }, {
              projection: {
                _id: 1
              }
            })
            .then(outbreak => {
              if (!outbreak) {
                return Promise.reject(`Given outbreak ${options.outbreakName} was not found in system`);
              }

              return outbreak._id;
            });
        }

        return getOutbreakId
          .then(outbreakId => {
            // update relationships filter if needed
            outbreakId && (relationshipsFilter.outbreakId = outbreakId);

            // count not deleted relationships
            return relationshipsCollection
              .countDocuments(relationshipsFilter);
          })
          .then(relationshipsNo => {
            if (!relationshipsNo) {
              // handleActionsInBatches will take care of this scenario
              return Promise.resolve(relationshipsNo);
            }

            // before going through batches reset persons data
            // Note: Currently we can use the relationshipsFilter also for persons
            return personCollection
              .updateMany(relationshipsFilter, {
                '$unset': {
                  hasRelationships: '',
                  // unset the relationshipsIds array added in v1 of the script
                  relationshipsIds: '',
                  // unset the container that will be constructed again
                  relationshipsRepresentation: ''
                }
              })
              .then(() => {
                // continue will relationships processing in batches
                return Promise.resolve(relationshipsNo);
              });
          });
      };

      const getBatchData = (batchNo, batchSize) => {
        // initialize map for persons with relationships
        let personsWithRelationshipsMap = {};

        // get relationships for batch
        return relationshipsCollection
          .find(relationshipsFilter, {
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              persons: 1,
              active: 1
            }
          })
          .toArray()
          .then(relationships => {
            // loop through the found relationships and fill the persons with relationships maps
            relationships.forEach(relationship => {
              relationship.persons.forEach((person, index) => {
                if (!personsWithRelationshipsMap[person.id]) {
                  // initialize map entry
                  personsWithRelationshipsMap[person.id] = {
                    id: person.id,
                    relationshipsRepresentation: []
                  };
                }

                // get other participant
                let otherParticipant = relationship.persons[index === 0 ? 1 : 0];

                // add new entry in map
                personsWithRelationshipsMap[person.id].relationshipsRepresentation.push({
                  id: relationship._id,
                  active: relationship.active,
                  otherParticipantType: otherParticipant.type,
                  otherParticipantId: otherParticipant.id,
                  target: person.target,
                  source: person.source
                });
              });
            });

            // return the mapped values as they are needed in each item action
            return Object.values(personsWithRelationshipsMap);
          });
      };

      const itemAction = (data) => {
        return personCollection
          .updateOne({
            _id: data.id
          }, {
            '$set': {
              hasRelationships: true
            },
            '$addToSet': {
              relationshipsRepresentation: {
                '$each': data.relationshipsRepresentation
              }
            }
          });
      };

      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        relationshipsFindBatchSize,
        personsUpdateBatchSize,
        console
      );
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  setRelationshipsInformationOnPerson
};
