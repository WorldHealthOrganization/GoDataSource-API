'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with relationship related actions
 */

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');

module.exports = function (Outbreak) {
  /**
   * Delete all relationships matching specific conditions
   * @param where Mongo Query
   * @param callback
   */
  Outbreak.prototype.bulkDeleteRelationships = function (where, options, callback) {
    // where is required so we don't remove all relationships from an outbreak unless we want to do that :)
    if (_.isEmpty(where)) {
      return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
        model: app.models.relationship.modelName,
        details: 'Where should be a non-empty query'
      }));
    }

    // retrieve relationships
    app.models.relationship
      .rawFind(app.utils.remote.convertLoopbackFilterToMongo({
        $and: [
          {
            deleted: {
              $ne: true
            },
            outbreakId: this.id
          },
          where
        ]
      }), {
        projection: {
          _id: 1,
          persons: 1
        }
      })
      .then((relationships) => {
        // nothing to delete ?
        if (_.isEmpty(relationships)) {
          return null;
        }

        // map relationships to easily identify what will be removed
        // & determine contacts associated with these relationships
        const mappedData = relationships.reduce((accumulator, relationship) => {
          // validate persons
          if (
            !relationship.persons ||
            relationship.persons.length !== 2
          ) {
            return accumulator;
          }

          relationship.persons.forEach(person => {
            let mapContainer = 'otherPersons';
            let idsContainer = 'otherPersonsIds';
            if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
              mapContainer = 'contacts';
              idsContainer = 'contactsIds';
            }

            // initialize map to be used later to determine relationships deleted
            // this way we can determine if one of contacts will become isolated ( no exposure )
            if (!accumulator[mapContainer][person.id]) {
              accumulator[mapContainer][person.id] = {
                deleteRelationships: [],
                relatedRelationships: []
              };
            }

            // map deleted relationship
            accumulator[mapContainer][person.id].deleteRelationships.push(relationship.id);
            // cache person ID
            accumulator[idsContainer].push(person.id);
          });

          // map relationships
          accumulator.relationships[relationship.id] = relationship;
          return accumulator;
        }, {
          relationships: {},
          contacts: {},
          contactsIds: [],
          otherPersons: {},
          otherPersonsIds: []
        });

        // there are no contact relationships that we want to remove, so there is no point in validating ( retrieving the contact relationships )
        if (!mappedData.contactsIds.length) {
          return mappedData;
        }

        // retrieve all found contacts in order to get their current relationships
        return app.models.person
          .rawFind({
            _id: {
              $in: mappedData.contactsIds
            }
          }, {
            projection: {
              relationshipsIds: 1
            }
          })
          .then(contacts => {
            // cache contacts relationships
            contacts.forEach(contact => {
              mappedData.contacts[contact.id].relatedRelationships = contact.relationshipsIds;
            });

            return mappedData;
          });
      })
      .then((data) => {
        // nothing to delete ?
        if (_.isEmpty(data)) {
          return null;
        }

        // there are no contact relationships that we want to remove, so there is no point in validating
        if (!data.contactsIds.length) {
          return data;
        }

        // determine if at least one of the relationships we're trying to remove contains a contact that will remain without an exposure
        // in this case we need to stop the delete bulk process & throw a detailed error ( contact ids that will remain without exposures... )
        const isolatedContacts = [];
        _.each(data.contacts, (contactData, contactId) => {
          // check if this will become an isolated contact if we remove data
          // this condition always will be either equal ( isolated case ), or greater, but never less...but it doesn't matter :)
          if (contactData.relatedRelationships.length <= contactData.deleteRelationships.length) {
            // we found an isolated contact
            isolatedContacts.push(contactId);
          }
        });

        // can't delete relationships because at least one case will become isolated after that
        if (!_.isEmpty(isolatedContacts)) {
          throw app.utils.apiError.getError('DELETE_CONTACT_LAST_RELATIONSHIP', {
            contactIDs: isolatedContacts.join(', '),
            contactIDsArray: isolatedContacts
          });
        }

        // proceed with removing relationships
        return data;
      })
      .then((data) => {
        let relationshipsToDelete = data.relationships;
        // nothing to delete ?
        if (_.isEmpty(relationshipsToDelete)) {
          // no records deleted
          return callback(null, 0);
        }

        // initialize removed relationships count
        let removedCount;
        // delete relationships
        return app.models.relationship
          .rawBulkDelete({
            _id: {
              $in: Object.keys(relationshipsToDelete)
            }
          })
          .then((count) => {
            // cache count
            removedCount = count;

            // relationships were removed; update relationships information on all related persons
            // we have different logic for contacts as we already have their data
            if (!data.contactsIds.length) {
              return Promise.resolve();
            }

            // we have contacts
            // create functions to be used in handleActionsInBatches
            const getActionsCount = function () {
              return Promise.resolve(data.contactIds.length);
            };
            const getBatchData = function (batchNo, batchSize) {
              let contactsBatch = data.contactsIds.slice((batchNo - 1) * batchSize, batchSize);
              return Promise.resolve(contactsBatch.map(contactId => {
                return {
                  id: contactId,
                  deleteRelationships: data.contacts[contactId].deleteRelationships,
                  relatedRelationships: data.contacts[contactId].relatedRelationships
                };
              }));
            };
            const itemAction = function (item) {
              return app.models.person
                .rawUpdateOne({
                  _id: item.id
                }, {
                  relationshipsIds: item.relatedRelationships.filter(relId => !item.deleteRelationships.includes(relId))
                }, options, {
                  returnUpdatedResource: false
                });
            };
            return helpers.handleActionsInBatches(getActionsCount, getBatchData, itemAction, 1000, 10, options.remotingContext.req.logger);
          })
          .then(() => {
            // update other persons; we will always have some persons in list
            // create functions to be used in handleActionsInBatches
            const getActionsCount = function () {
              return Promise.resolve(data.otherPersonsIds.length);
            };
            const getBatchData = function (batchNo, batchSize) {
              // get persons data for batch
              return app.models.person
                .rawFind({
                  _id: {
                    $in: data.otherPersonsIds
                  }
                }, {
                  skip: (batchNo - 1) * batchSize,
                  limit: batchSize,
                  sort: {
                    createdAt: 1
                  },
                  projection: {
                    relationshipsIds: 1
                  }
                });
            };
            const itemAction = function (item) {
              return app.models.person
                .rawUpdateOne({
                  _id: item.id
                }, {
                  relationshipsIds: item.relationshipsIds.filter(relId => !data.otherPersons[item.id].deleteRelationships.includes(relId))
                }, options, {
                  returnUpdatedResource: false
                });
            };

            return helpers.handleActionsInBatches(getActionsCount, getBatchData, itemAction, 1000, 10, options.remotingContext.req.logger);
          })
          .then(() => {
            // done
            callback(
              null,
              removedCount && removedCount.modifiedCount ?
                removedCount.modifiedCount :
                0
            );
          });
      })
      .catch(callback);
  };
};
