'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const _ = require('lodash');
const Config = require('../../../../config.json');
const CaseConstants = require('../../../../../components/baseModelOptions/case').constants;

// Note: we shouldn't set batchSize to more than ~27000 as in case all relationships participants are different
// we would make a query in MongoDB with more than ~54000 person IDs which would exceed 16MB limit
const relationshipsFindBatchSize = _.get(Config, 'jobSettings.setRelationshipInformationOnPerson.batchSize', 1000);

// set how many person update actions to run in parallel
const personsUpdateBatchSize = 10;

/**
 * Set hasRelationships flag as true on all persons which have relationships
 * Set relationships information in relationshipsRepresentation
 * Update relationship active flag if needed
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

      // initialize personsFilter
      let personsFilter = {
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
            // update relationships and persons filters if needed
            if (outbreakId) {
              relationshipsFilter.outbreakId = outbreakId;
              personsFilter.outbreakId = outbreakId;
            }

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
              .updateMany(personsFilter, {
                '$unset': {
                  // unset the relationshipsIds array added in v1 of the script
                  relationshipsIds: ''
                },
                '$set': {
                  // set flag to false in order to not need to do queries with $exists for it
                  hasRelationships: false,
                  // initialize relationshipsRepresentation container that will be filled again for the required persons
                  relationshipsRepresentation: []
                }
              })
              .then(() => {
                // continue with relationships processing in batches
                return Promise.resolve(relationshipsNo);
              });
          });
      };

      const getBatchData = (batchNo, batchSize) => {
        // caches
        let batchRelationships = [];

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
            // cache found relationships
            batchRelationships = relationships;

            // initialize container for casesIds as we will need to retrieve all cases in order to correctly calculate relationship active flag
            let casesIds = [];

            relationships.forEach(relationship => {
              // check if the relationship has at least a case
              // for these relationship we should check if the active flag is correct
              casesIds = casesIds.concat(relationship.persons.filter(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE').map(caseRecord => caseRecord.id));
            });

            // keep only unique cases IDs values
            casesIds = [...new Set(casesIds)];

            if (casesIds.length) {
              // get all cases classification
              return personCollection
                .find({
                  _id: {
                    '$in': casesIds
                  }
                }, {
                  projection: {
                    classification: 1
                  }
                })
                .toArray();
            }

            // no cases to retrieve
            return Promise.resolve();
          })
          .then(cases => {
            // create map of ID to case information
            let casesMap = {};
            if (cases) {
              cases.forEach(caseItem => {
                casesMap[caseItem._id] = caseItem;
              });
            }

            // initialize map of relationships whose active flag will need to be updated
            let relationshipsToUpdateMap = [];

            // initialize map for persons with relationships
            let personsWithRelationshipsMap = {};

            // loop through the found relationships and fill the persons with relationships maps
            batchRelationships.forEach(relationship => {
              // get current active status
              let currentActiveStatus = relationship.active;

              // calculate new relationship status
              // active: no discarded cases
              // inactive: at least one discarded case
              let newActiveStatus = relationship.persons
                .reduce((acc, person) => {
                  // acc is true by default; will be set to false on the first discarded case
                  return acc && (
                    // status is true for other person types
                    person.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ||
                    // for case check if it is discarded
                    !CaseConstants.discardedCaseClassifications.includes(casesMap[person.id].classification)
                  );
                }, true);

              // we need to update the relationship if the new status is different than the current status
              if (currentActiveStatus !== newActiveStatus) {
                relationshipsToUpdateMap.push({
                  id: relationship._id,
                  // set a value to know in the item action what update we need to do
                  type: 'relationship',
                  active: newActiveStatus
                });
              }

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
                  active: newActiveStatus,
                  otherParticipantType: otherParticipant.type,
                  otherParticipantId: otherParticipant.id,
                  target: person.target,
                  source: person.source
                });
              });
            });

            // return the mapped values as they are needed in each item action
            return relationshipsToUpdateMap.concat(Object.values(personsWithRelationshipsMap));
          });
      };

      const itemAction = (data) => {
        // check if the item to be update is a relationship or a person
        if (data.type === 'relationship') {
          return relationshipsCollection
            .updateOne({
              _id: data.id
            }, {
              '$set': {
                active: data.active
              }
            });
        }

        // item is a person
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
