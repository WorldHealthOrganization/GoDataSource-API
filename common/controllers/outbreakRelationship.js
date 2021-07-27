'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with relationship related actions
 */

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');
const WorkerRunner = require('./../../components/workerRunner');
const exportHelper = require('./../../components/exportHelper');

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
            deleted: false,
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

              // cache person ID
              accumulator[idsContainer].push(person.id);
            }

            // map deleted relationship
            accumulator[mapContainer][person.id].deleteRelationships.push(relationship.id);
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
              relationshipsRepresentation: 1
            }
          })
          .then(contacts => {
            // cache contacts relationships
            contacts.forEach(contact => {
              mappedData.contacts[contact.id].relatedRelationships = contact.relationshipsRepresentation;
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
        // nothing to delete ?
        if (!data || _.isEmpty(data.relationships)) {
          // no records deleted
          return callback(null, 0);
        }

        let relationshipsToDelete = data.relationships;

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
              return Promise.resolve(data.contactsIds.length);
            };
            const getBatchData = function (batchNo, batchSize) {
              let contactsBatch = data.contactsIds.slice((batchNo - 1) * batchSize, batchNo * batchSize);
              return Promise.resolve(contactsBatch.map(contactId => {
                return {
                  id: contactId,
                  deleteRelationships: data.contacts[contactId].deleteRelationships,
                  relatedRelationships: data.contacts[contactId].relatedRelationships
                };
              }));
            };
            const itemAction = function (item) {
              // get remaining relationships
              let remainingRelationships = item.relatedRelationships.filter(rel => !item.deleteRelationships.includes(rel.id));

              return app.models.person
                .rawUpdateOne({
                  _id: item.id
                }, {
                  // no need to update hasRelationships flag as for contacts will not change
                  // hasRelationships: !!remainingRelationships.length,
                  relationshipsRepresentation: remainingRelationships
                }, options, {
                  returnUpdatedResource: false
                });
            };
            return helpers.handleActionsInBatches(
              getActionsCount,
              getBatchData,
              null,
              itemAction,
              1000,
              10,
              options.remotingContext.req.logger
            );
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
                    relationshipsRepresentation: 1
                  }
                });
            };
            const itemAction = function (item) {
              // get remaining relationships
              let remainingRelationships = item.relationshipsRepresentation.filter(rel => !data.otherPersons[item.id].deleteRelationships.includes(rel.id));

              return app.models.person
                .rawUpdateOne({
                  _id: item.id
                }, {
                  hasRelationships: !!remainingRelationships.length,
                  relationshipsRepresentation: remainingRelationships
                }, options, {
                  returnUpdatedResource: false
                });
            };

            return helpers.handleActionsInBatches(
              getActionsCount,
              getBatchData,
              null,
              itemAction,
              1000,
              10,
              options.remotingContext.req.logger
            );
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

  /**
   * Find outbreak relationships
   */
  Outbreak.prototype.findRelationships = function (filter, callback) {
    // make sure filter exists
    filter = filter || {};

    // required conditions
    const requiredWhere = {
      outbreakId: this.id
    };

    // merge where conditions ?
    if (filter.where) {
      filter.where = {
        and: [
          filter.where,
          requiredWhere
        ]
      };
    } else {
      filter.where = requiredWhere;
    }

    // retrieve relationships
    app.models.relationship
      .find(filter)
      .then((records) => {
        return callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count outbreak relationships
   */
  Outbreak.prototype.countRelationships = function (where, callback) {
    // required conditions
    const requiredWhere = {
      outbreakId: this.id
    };

    // merge where conditions ?
    if (where) {
      where = {
        and: [
          where,
          requiredWhere
        ]
      };
    } else {
      where = requiredWhere;
    }

    // retrieve relationships
    app.models.relationship
      .count(where)
      .then((count) => {
        return callback(null, count);
      })
      .catch(callback);
  };

  Outbreak.beforeRemote('prototype.exportFilteredRelationships', function (context, modelInstance, next) {
    // remove custom filter options
    // technical debt from front end
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};
    context.args.filter.where = context.args.filter.where || {};
    context.args.filter.where.person = context.args.filter.where.person || {};
    delete context.args.filter.where.person.countRelations;

    return next();
  });

  /**
   * Export filtered relationships to file
   * @param filter Supports 'where.person' & 'where.followUp' MongoDB compatible queries. For person please include type in case you want to filter only cases, contacts etc.
   * If you include both person & followUp conditions, then and AND will be applied between them.
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredRelationships = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // relationships only from our outbreak
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // include geo restrictions if necessary
    // #TODO

    // relationship prefilters
    // #TODO - still to implement if necessary for followUp
    // anyways even if the export won't fail, the list page request will fail because it doesn't use this system..which is kinda slow for listing
    const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
      filter, {
        outbreakId: this.id
      }, {
        person: {
          queryPath: 'where.person',
          matchKey: 'persons[].id',
          matchKeyArraySize: 2,
          collection: 'person'
        }
      }
    );

    // export
    WorkerRunner.helpers
      .exportFilteredModelsList({
        collectionName: 'relationship',
        modelName: app.models.relationship.modelName,
        scopeQuery: app.models.relationship.definition.settings.scope,
        arrayProps: app.models.relationship.arrayProps,
        fieldLabelsMap: app.models.relationship.helpers.sanitizeFieldLabelsMapForExport(),
        exportFieldsGroup: app.models.relationship.exportFieldsGroup,
        exportFieldsOrder: app.models.relationship.exportFieldsOrder,
        locationFields: app.models.relationship.locationFields,

        // fields that we need to bring from db, but we don't want to include in the export
        projection: [
          'persons'
        ]
      },
      filter,
      exportType,
      encryptPassword,
      anonymizeFields,
      fieldsGroupList,
      {
        userId: _.get(options, 'accessToken.userId'),
        outbreakId: this.id,
        questionnaire: undefined,
        useQuestionVariable: false,
        useDbColumns,
        dontTranslateValues,
        contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
      },
      prefilters, {
        sourcePerson: {
          type: exportHelper.RELATION_TYPE.HAS_ONE,
          collection: 'person',
          project: [
            '_id',
            'visualId',
            'type',
            'name',
            'lastName',
            'firstName',
            'middleName',
            'gender',
            'dob',
            'age'
          ],
          key: '_id',
          keyValue: `(relationship) => {
            return relationship && relationship.persons && relationship.persons.length === 2 ?
              (
                relationship.persons[0].source && relationship.persons[1].target ?
                  relationship.persons[0].id : (
                    relationship.persons[1].source && relationship.persons[0].target ?
                      relationship.persons[1].id :
                      undefined
                  )
              ) :
              undefined;
          }`,
          after: `(relationship) => {
            // no person ?
            if (!relationship.sourcePerson) {
              return;
            }

            // attach properties
            relationship.sourcePerson.source = true;
          }`
        },
        targetPerson: {
          type: exportHelper.RELATION_TYPE.HAS_ONE,
          collection: 'person',
          project: [
            '_id',
            'visualId',
            'type',
            'name',
            'lastName',
            'firstName',
            'middleName',
            'gender',
            'dob',
            'age'
          ],
          key: '_id',
          keyValue: `(relationship) => {
            return relationship && relationship.persons && relationship.persons.length === 2 ?
              (
                relationship.persons[0].source && relationship.persons[1].target ?
                  relationship.persons[1].id : (
                    relationship.persons[1].source && relationship.persons[0].target ?
                      relationship.persons[0].id :
                      undefined
                  )
              ) :
              undefined;
          }`,
          after: `(relationship) => {
            // no person ?
            if (!relationship.targetPerson) {
              return;
            }

            // attach properties
            relationship.targetPerson.target = true;
          }`
        }
      })
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
  };
};
