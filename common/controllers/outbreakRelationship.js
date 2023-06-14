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
const Platform = require('../../components/platform');
const importableFile = require('./../../components/importableFile');
const Config = require('../../server/config.json');

// used in relationship import
const relationshipImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

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
            if (
              person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' ||
              person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
            ) {
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
          types: {},
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
              type: 1,
              relationshipsRepresentation: 1
            }
          })
          .then(contacts => {
            // cache type and contacts relationships
            contacts.forEach(contact => {
              mappedData.types[contact.id] = contact.type;
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
          // find isolated contacts by removing the relationships that will be deleted and the "contacts" relationships
          const exposureTypes = data.types[contactId] === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT' ?
            ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'] :
            ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'];
          const exposureRelationships = contactData.relatedRelationships.filter((relation) => relation.active &&
            relation.target &&
            !contactData.deleteRelationships.includes(relation.id) &&
            exposureTypes.includes(relation.otherParticipantType)
          );
          if (!exposureRelationships.length) {
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
              const noOfExposuresAndContacts = helpers.countPeopleContactsAndExposures({
                relationshipsRepresentation: remainingRelationships
              });

              return app.models.person
                .rawUpdateOne({
                  _id: item.id
                }, {
                  // no need to update hasRelationships flag as for contacts will not change
                  // hasRelationships: !!remainingRelationships.length,
                  relationshipsRepresentation: remainingRelationships,
                  numberOfContacts: noOfExposuresAndContacts.numberOfContacts,
                  numberOfExposures: noOfExposuresAndContacts.numberOfExposures
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
              const noOfExposuresAndContacts = helpers.countPeopleContactsAndExposures({
                relationshipsRepresentation: remainingRelationships
              });

              return app.models.person
                .rawUpdateOne({
                  _id: item.id
                }, {
                  hasRelationships: !!remainingRelationships.length,
                  relationshipsRepresentation: remainingRelationships,
                  numberOfContacts: noOfExposuresAndContacts.numberOfContacts,
                  numberOfExposures: noOfExposuresAndContacts.numberOfExposures
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

  /**
   * Export filtered relationships to file
   * @param filter Supports 'where.person' & 'where.followUp' MongoDB compatible queries. For person please include type in case you want to filter only cases, contacts etc.
   * If you include both person & followUp conditions, then and AND will be applied between them.
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
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
    filter.where.outbreakId = this.id;

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

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // attach geo restrictions if necessary
    app.models.person
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where.person
      )
      .then((updatedFilter) => {
        // update casesQuery if needed
        updatedFilter && (filter.where.person = updatedFilter);

        // relationship prefilters
        const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
          filter, {
            outbreakId: this.id
          }, {
            person: {
              collection: 'person',
              queryPath: 'where.person',
              localKey: 'persons[].id',
              localKeyArraySize: 2,
              prefilters: exportHelper.generateAggregateFiltersFromNormalFilter(
                filter, {
                  outbreakId: this.id
                }, {
                  followUp: {
                    collection: 'followUp',
                    queryPath: 'where.followUp',
                    localKey: '_id',
                    foreignKey: 'personId'
                  },
                  labResult: {
                    collection: 'labResult',
                    queryPath: 'where.labResult',
                    localKey: '_id',
                    foreignKey: 'personId'
                  }
                }
              )
            }
          }
        );

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'relationship',
            modelName: app.models.relationship.modelName,
            scopeQuery: app.models.relationship.definition.settings.scope,
            excludeBaseProperties: app.models.relationship.definition.settings.excludeBaseProperties,
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
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          prefilters, {
            cluster: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'cluster',
              project: [
                '_id',
                'name'
              ],
              key: '_id',
              keyValue: `(relationship) => {
                return relationship && relationship.clusterId ?
                  relationship.clusterId :
                  undefined;
              }`,
              replace: {
                'clusterId': {
                  value: 'cluster.name'
                }
              }
            },
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
          });
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

  /**
   * Import an importable relationships file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableRelationshipsFileUsingMap = function (body, options, callback) {
    const self = this;

    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    options._sync = false;
    // inject platform identifier
    options.platform = Platform.IMPORT;

    /**
     * Create array of actions that will be executed in series for each batch
     * Note: Failed items need to have success: false and any other data that needs to be saved on error needs to be added in a error container
     * @param {Array} batchData - Batch data
     * @returns {Promise<*[]>}
     */
    const createBatchActions = function (batchData) {
      // build a list of create operations
      const createOps = [];
      // go through all entries
      batchData.forEach((relation) => {
        createOps.push(callback => {
          return app.utils.dbSync.syncRecord(
            app,
            app.models.relationship,
            relation.save,
            options
          )
            .then(() => callback())
            .catch(err => {
              callback(null, {
                success: false,
                error: {
                  error: err,
                  data: {
                    file: relation.raw,
                    save: relation.save
                  }
                }
              });
            });
        });
      });

      return createOps;
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = helpers.getModelPropertiesByDataType(
      app.models.relationship,
      helpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = helpers.getModelPropertiesByDataType(
      app.models.relationship,
      helpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'relationship',
      batchSize: relationshipImportBatchSize,
      outbreakId: self.id,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.relationship.modelName,
      outbreakId: self.id,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };
};
