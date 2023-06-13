'use strict';

const transmissionChain = require('../../components/workerRunner').transmissionChain;
const app = require('../../server/server');
const _ = require('lodash');
const async = require('async');

module.exports = function (Relationship) {
  // set flag to not get controller
  Relationship.hasController = false;

  // initialize model helpers
  Relationship.helpers = {};

  /**
   * Return a list of field labels map that are allowed for export
   */
  Relationship.helpers.sanitizeFieldLabelsMapForExport = () => {
    // make sure we don't alter the original array
    const fieldLabelsMap = {};

    // relationship person labels
    const personFieldLabelsMap = {
      'id': 'LNG_ENTITY_FIELD_LABEL_ID',
      'visualId': 'LNG_ENTITY_FIELD_LABEL_VISUAL_ID',
      'type': 'LNG_RELATIONSHIP_FIELD_LABEL_TYPE',
      'name': 'LNG_ENTITY_FIELD_LABEL_NAME',
      'lastName': 'LNG_ENTITY_FIELD_LABEL_LAST_NAME',
      'firstName': 'LNG_ENTITY_FIELD_LABEL_FIRST_NAME',
      'middleName': 'LNG_ENTITY_FIELD_LABEL_MIDDLE_NAME',
      'gender': 'LNG_ENTITY_FIELD_LABEL_GENDER',
      'dob': 'LNG_ENTITY_FIELD_LABEL_DOB',
      'age': 'LNG_ENTITY_FIELD_LABEL_AGE',
      'age.years': 'LNG_ENTITY_FIELD_LABEL_AGE_YEARS',
      'age.months': 'LNG_ENTITY_FIELD_LABEL_AGE_MONTHS',
    };

    // append source export fields
    Object.assign(
      fieldLabelsMap,
      Relationship.fieldLabelsMap,
      {
        'sourcePerson': 'LNG_RELATIONSHIP_FIELD_LABEL_SOURCE',
        'sourcePerson.source': 'LNG_RELATIONSHIP_FIELD_LABEL_SOURCE'
      },
      _.transform(
        personFieldLabelsMap,
        (tokens, token, property) => {
          tokens[`sourcePerson.${property}`] = token;
        },
        {}
      )
    );

    // append target export fields
    Object.assign(
      fieldLabelsMap,
      Relationship.fieldLabelsMap,
      {
        'targetPerson': 'LNG_RELATIONSHIP_FIELD_LABEL_TARGET',
        'targetPerson.target': 'LNG_RELATIONSHIP_FIELD_LABEL_TARGET'
      },
      _.transform(
        personFieldLabelsMap,
        (tokens, token, property) => {
          tokens[`targetPerson.${property}`] = token;
        },
        {}
      )
    );

    // sanitize
    delete fieldLabelsMap.persons;
    delete fieldLabelsMap['persons[].type'];
    delete fieldLabelsMap['persons[].id'];
    delete fieldLabelsMap['persons[].target'];
    delete fieldLabelsMap['persons[].source'];

    // finished
    return fieldLabelsMap;
  };

  Relationship.fieldLabelsMap = Object.assign({}, Relationship.fieldLabelsMap, {
    persons: 'LNG_RELATIONSHIP_FIELD_LABEL_PERSONS',
    'persons[].type': 'LNG_RELATIONSHIP_FIELD_LABEL_TYPE',
    'persons[].id': 'LNG_RELATIONSHIP_FIELD_LABEL_RELATED_PERSON',
    'persons[].target': 'LNG_RELATIONSHIP_FIELD_LABEL_TARGET',
    'persons[].source': 'LNG_RELATIONSHIP_FIELD_LABEL_SOURCE',
    dateOfFirstContact: 'LNG_RELATIONSHIP_FIELD_LABEL_DATE_OF_FIRST_CONTACT',
    contactDate: 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE',
    contactDateEstimated: 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE_ESTIMATED',
    certaintyLevelId: 'LNG_RELATIONSHIP_FIELD_LABEL_CERTAINTY_LEVEL',
    exposureTypeId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_TYPE',
    exposureFrequencyId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_FREQUENCY',
    exposureDurationId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_DURATION',
    socialRelationshipTypeId: 'LNG_RELATIONSHIP_FIELD_LABEL_RELATION',
    socialRelationshipDetail: 'LNG_RELATIONSHIP_FIELD_LABEL_RELATION_DETAIL',
    clusterId: 'LNG_RELATIONSHIP_FIELD_LABEL_CLUSTER',
    comment: 'LNG_RELATIONSHIP_FIELD_LABEL_COMMENT'
  });

  // map language token labels for export fields group
  Relationship.exportFieldsGroup = {
    'LNG_COMMON_LABEL_EXPORT_GROUP_RECORD_CREATION_AND_UPDATE_DATA': {
      properties: [
        'id',
        'createdAt',
        'createdBy',
        'updatedAt',
        'updatedBy',
        'deleted',
        'deletedAt',
        'createdOn'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_CORE_DEMOGRAPHIC_DATA': {
      properties: [
        'sourcePerson',
        'sourcePerson.id',
        'sourcePerson.visualId',
        'sourcePerson.type',
        'sourcePerson.name',
        'sourcePerson.lastName',
        'sourcePerson.firstName',
        'sourcePerson.middleName',
        'sourcePerson.gender',
        'sourcePerson.dob',
        'sourcePerson.age',
        'sourcePerson.age.years',
        'sourcePerson.age.months',
        'sourcePerson.source',
        'targetPerson',
        'targetPerson.id',
        'targetPerson.visualId',
        'targetPerson.type',
        'targetPerson.name',
        'targetPerson.lastName',
        'targetPerson.firstName',
        'targetPerson.middleName',
        'targetPerson.gender',
        'targetPerson.dob',
        'targetPerson.age',
        'targetPerson.age.years',
        'targetPerson.age.months',
        'targetPerson.target'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_EPIDEMIOLOGICAL_DATA': {
      properties: [
        'dateOfFirstContact',
        'contactDate',
        'contactDateEstimated',
        'certaintyLevelId',
        'exposureTypeId',
        'exposureFrequencyId',
        'exposureDurationId',
        'socialRelationshipTypeId',
        'socialRelationshipDetail',
        'clusterId',
        'comment'
      ]
    }
  };

  Relationship.arrayProps = {
    persons: {
      'id': 'LNG_RELATIONSHIP_FIELD_LABEL_RELATED_PERSON',
      'type': 'LNG_RELATIONSHIP_FIELD_LABEL_TYPE',
      'target': 'LNG_RELATIONSHIP_FIELD_LABEL_TARGET',
      'source': 'LNG_RELATIONSHIP_FIELD_LABEL_SOURCE'
    }
  };

  Relationship.referenceDataFieldsToCategoryMap = {
    certaintyLevelId: 'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL',
    exposureTypeId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
    exposureFrequencyId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
    exposureDurationId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION',
    socialRelationshipTypeId: 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION',
    'persons[].type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
  };

  Relationship.referenceDataFields = Object.keys(Relationship.referenceDataFieldsToCategoryMap);

  // define a list of custom (non-loopback-supported) relations
  Relationship.customRelations = {
    people: {
      type: 'belongsToManyComplex',
      model: 'person',
      foreignKeyContainer: 'persons',
      foreignKey: 'id'
    }
  };

  Relationship.foreignKeyResolverMap = {
    clusterId: {
      modelName: 'cluster',
      useProperty: 'name'
    }
  };

  // used on importable file logic
  Relationship.foreignKeyFields = {
    clusterId: {
      modelName: 'cluster',
      collectionName: 'cluster',
      labelProperty: 'name',
      // mongoDB filter by outbreak properties
      filter: {
        outbreakId: 'outbreak.id'
      }
    }
  };

  Relationship.relatedFieldLabelsMap = {
    'person': 'LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON'
  };

  Relationship.printFieldsinOrder = [
    'dateOfFirstContact',
    'contactDate',
    'contactDateEstimated',
    'certaintyLevelId',
    'exposureTypeId',
    'exposureFrequencyId',
    'exposureDurationId',
    'clusterId',
    'socialRelationshipTypeId',
    'socialRelationshipDetail',
    'comment',
    'person'
  ];

  /**
   * Build or count transmission chains for an outbreak
   * @param outbreakId
   * @param followUpPeriod
   * @param filter Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param countOnly
   * @param countContacts Flag that indicates that contacts too should be counted per chain
   * @param noContactChains
   * @param geographicalRestrictionsQuery Geographical restriction query for user and outbreak
   * @param callback
   */
  Relationship.buildOrCountTransmissionChains = function (
    outbreakId,
    followUpPeriod,
    filter,
    countOnly,
    countContacts,
    noContactChains,
    geographicalRestrictionsQuery,
    callback
  ) {
    // define an endDate filter
    let endDate;
    // if there's a filter
    if (filter) {
      // try and get the end date filter
      endDate = _.get(filter, 'where.endDate');
      _.unset(filter, 'where.endDate');
    }
    // no end date filter provided
    if (!endDate) {
      // end date is current date
      endDate = new Date();
    }

    // build a filter: get all relations between non-discarded cases and contacts + events from current outbreak
    const originalFilter = filter;
    filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          contactDate: {
            lte: endDate
          }
        },
        include: {
          relation: 'people',
          scope: {
            where: {
              or: [
                {
                  type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  classification: {
                    nin: app.models.case.discardedCaseClassifications
                  }
                },
                {
                  type: {
                    inq: [
                      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
                      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                    ]
                  }
                }
              ]
            },
            filterParent: true
          }
        }
      }, filter || {});

    // use raw queries for relationships
    app.models.relationship
      .rawFind(
        app.utils.remote.convertLoopbackFilterToMongo(filter.where),
        originalFilter.retrieveFields && originalFilter.retrieveFields.edges ? {
          projection: originalFilter.retrieveFields.edges
        } : {}
      )
      .then(function (relationships) {
        // build a list of people ids (to query related data later)
        const peopleIds = {};
        // go through all relationships
        relationships.forEach(function (relationship) {
          // go through relationship persons
          Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
            // store person ids
            peopleIds[person.id] = true;
          });
        });
        // get person query from include filters
        let personQuery = app.utils.remote.searchByRelationProperty.convertIncludeQueryToFilterQuery(filter).people;
        personQuery = app.utils.remote.mergeFilters(
          personQuery,
          {
            where: {
              id: {
                inq: Object.keys(peopleIds)
              }
            }
          }).where;
        geographicalRestrictionsQuery && (personQuery = {
          and: [
            personQuery,
            geographicalRestrictionsQuery
          ]
        });
        // use raw queries for related people
        return app.models.person
          .rawFind(
            personQuery,
            originalFilter.retrieveFields && originalFilter.retrieveFields.nodes ? {
              projection: originalFilter.retrieveFields.nodes
            } : {}
          )
          .then(function (people) {
            // build a map of people to easily connect them to relations
            const peopleMap = {};
            people.forEach(function (person) {
              peopleMap[person.id] = person;
            });
            // add people to relations
            relationships.forEach(function (relationship) {
              // add people information to the relationship
              relationship.people = [];
              Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
                if (peopleMap[person.id]) {
                  relationship.people.push(peopleMap[person.id]);
                }
              });
            });
            // add filterParent support
            relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, filter);
            if (countOnly) {
              // count transmission chain - set activeChainStartDate - used for determining if a chain is active - to be specified endDate (by default today)
              transmissionChain.count(relationships, followUpPeriod, {activeChainStartDate: endDate}, callback);
            } else {
              // build transmission chain - set activeChainStartDate - used for determining if a chain is active - to be specified endDate (by default today)
              transmissionChain.build(
                relationships,
                followUpPeriod,
                {
                  activeChainStartDate: endDate,
                  countContacts: countContacts,
                  noContactChains: noContactChains
                },
                callback);
            }
          });
      })
      .catch(callback);
  };

  /**
   * Build transmission chains for an outbreak
   * @param outbreakId
   * @param followUpPeriod
   * @param filter Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param countContacts
   * @param noContactChains
   * @param geographicalRestrictionsQuery Geographical restrictions query for user and outbreak
   * @param callback
   */
  Relationship.getTransmissionChains = function (outbreakId, followUpPeriod, filter, countContacts, noContactChains, geographicalRestrictionsQuery, callback) {
    Relationship.buildOrCountTransmissionChains(outbreakId, followUpPeriod, filter, false, countContacts, noContactChains, geographicalRestrictionsQuery, callback);
  };

  /**
   * Count transmission chains for an outbreak
   * @param outbreakId
   * @param followUpPeriod
   * @param filter Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param geographicalRestrictionsQuery Geographical restrictions query for user and outbreak
   * @param callback
   */
  Relationship.countTransmissionChains = function (outbreakId, followUpPeriod, filter, geographicalRestrictionsQuery, callback) {
    Relationship.buildOrCountTransmissionChains(outbreakId, followUpPeriod, filter, true, false, true, geographicalRestrictionsQuery, callback);
  };

  /**
   * Filter known transmission chains
   * @param outbreakId
   * @param filter
   * @param options Options from request
   * @return {*|PromiseLike<T>|Promise<T>} Promise that resolves a list of relationships
   */
  Relationship.filterKnownTransmissionChains = function (outbreakId, filter, options) {
    let _filter;

    // check for geographical restrictions
    return app.models.person
      .addGeographicalRestrictions(options.remotingContext)
      .then(geographicalRestricationsQuery => {
        // initialize people query
        let peopleQuery = {
          classification: {
            nin: app.models.case.discardedCaseClassifications
          }
        };

        // add geographical restrictions if needed
        geographicalRestricationsQuery && (peopleQuery = {
          and: [
            peopleQuery,
            geographicalRestricationsQuery
          ]
        });

        // transmission chains are formed by case-case relations of non-discarded cases
        _filter = app.utils.remote
          .mergeFilters({
            where: {
              outbreakId: outbreakId,
              'persons.0.type': {
                inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
              },
              'persons.1.type': {
                inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
              }
            },
            include: {
              relation: 'people',
              scope: {
                where: peopleQuery,
                filterParent: true
              }
            }
          }, filter || {});

        // find relationships
        return Relationship
          .rawFind(_filter.where);
      })
      .then(function (relationships) {
        // build a list of people ids that are part of found relationships
        let peopleIds = [];
        // go through the relationships
        relationships.forEach(function (relationship) {
          // go through the people of the relationship
          Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
            // store person id
            peopleIds.push(person.id);
          });
        });
        // get person query from the include filter
        let personQuery = app.utils.remote.searchByRelationProperty.convertIncludeQueryToFilterQuery(_filter).people;
        // find people involved in the relationships
        return app.models.person
          .rawFind({
            $and: [
              personQuery,
              {
                type: {
                  $in: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                },
                _id: {
                  $in: peopleIds
                }
              },
              {outbreakId: outbreakId}
            ]
          })
          .then(function (people) {
            // build a map of people ids to person, to easily reference them in relationships
            const peopleIdsMap = {};
            people.forEach(function (person) {
              peopleIdsMap[person.id] = person;
            });
            // keep only valid relationships (both people passed the filters)
            return relationships.filter(function (relationship) {
              // assume the relationship is valid
              let isValid = true;
              // add people information to it
              relationship.people = [];
              relationship.persons.forEach(function (person) {
                // if one of the people is not found
                if (!peopleIdsMap[person.id]) {
                  // relationship is invalid
                  isValid = false;
                } else {
                  relationship.people.push(peopleIdsMap[person.id]);
                }
              });
              return isValid;
            });
          });
      });
  };

  /**
   * Forward transmission chain builder/counter
   * @type {{build: build, count: count}}
   */
  Relationship.transmissionChain = {
    /**
     * Build transmission chains
     * @param relationships
     * @param followUpPeriod
     * @param options {{activeChainStartDate: Date}}
     * @param callback
     */
    build: function (relationships, followUpPeriod, options, callback) {
      transmissionChain.build(relationships, followUpPeriod, options, callback);
    },
    /**
     * Count transmission chains
     * @param relationships
     * @param followUpPeriod
     * @param options {{activeChainStartDate: Date}}
     * @param callback
     */
    count: function (relationships, followUpPeriod, options, callback) {
      transmissionChain.build(relationships, followUpPeriod, options, callback);
    }
  };

  /**
   * Get all cases and list of contacts per case (only IDs)
   * Also count cases and contacts linked to cases
   * @param outbreakId
   * @param filter
   * @param options Options from request
   */
  Relationship.getCasesWithContacts = function (outbreakId, filter, options) {
    filter = filter || {};
    // initialize result
    let result = {
      casesCount: 0,
      contactsCount: 0,
      // map of cases to contact details
      cases: {}
    };
    // get people query
    let peopleQuery = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter).people;
    // by default filter people does not perform any task
    let filterPeople = Promise.resolve();
    // if a people query is provided
    if (peopleQuery) {
      peopleQuery = {
        and: [
          peopleQuery,
          {
            outbreakId: outbreakId,
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
            classification: {
              $nin: app.models.case.discardedCaseClassifications
            }
          }
        ]
      };
    } else {
      peopleQuery = {
        outbreakId: outbreakId,
        type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
        classification: {
          $nin: app.models.case.discardedCaseClassifications
        }
      };
    }

    // add geographic restriction if needed
    filterPeople = app.models.case
      .addGeographicalRestrictions(options.remotingContext, peopleQuery)
      .then(updatedFilter => {
        updatedFilter && (peopleQuery = updatedFilter);

        // find the people that match the query
        return app.models.person
          .rawFind(peopleQuery, {projection: {_id: 1}});
      })
      .then(function (people) {
        // return a list of people ids
        return people.map((person) => person.id);
      });

    // first filter people
    return filterPeople
      .then(function (peopleIds) {
        // build filter for relationships
        let _filter = {
          where: {
            outbreakId: outbreakId,
            and: [
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'},
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'}
            ]
          }
        };

        // update filter to include the ids
        _filter.where['persons.id'] = {
          inq: peopleIds
        };

        // get all relationships between cases and contacts
        return app.models.relationship
          .rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(
              app.utils.remote.mergeFilters(_filter, filter || {})).where
          )
          .then(function (relationships) {

            // initialize contacts map and caseContactsMap
            // helper properties to keep the contacts already counted
            let contactsMap = {};
            let caseContactsMap = {};

            // loop through the relationships and populate the casesMap;
            // Note: This loop will only add the cases that have relationships. Will need to do another query to get the cases without relationships
            relationships.forEach(function (relationship) {
              // get case index from persons
              let caseIndex = relationship.persons.findIndex((elem) => elem.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE');
              // get caseId, contactId
              // there are only 2 persons so the indexes are 0 or 1
              let caseId = relationship.persons[caseIndex].id;
              let contactId = relationship.persons[caseIndex ? 0 : 1].id;

              // create entry for the case in the result.cases if not already created
              if (!result.cases[caseId]) {
                result.cases[caseId] = {
                  id: caseId,
                  contactsCount: 0,
                  contactIDs: []
                };

                // also create entry for the caseContactsMap
                caseContactsMap[caseId] = {};

                // increase total counter
                result.casesCount++;
              }

              // count the contact only if not already counted
              if (!caseContactsMap[caseId][contactId]) {
                // get contactId flag in order to not count it twice for the case
                caseContactsMap[caseId][contactId] = true;
                // increase counter
                result.cases[caseId].contactsCount++;
                // add contactId
                result.cases[caseId].contactIDs.push(contactId);
              }

              if (!contactsMap[contactId]) {
                // get contactId flag in order to not count it twice in total
                contactsMap[contactId] = true;
                // increase total counter
                result.contactsCount++;
              }
            });
          })
          .then(() => {
            // in order to get the full results we need to also get the cases that don't have contacts
            peopleIds.forEach((caseId) => {
              if (!result.cases[caseId]) {
                result.cases[caseId] = {
                  id: caseId,
                  contactsCount: 0,
                  contactIDs: []
                };

                // increase total counter
                result.casesCount++;
              }
            });

            // return the entire result
            return result;
          });
      });
  };

  /**
   * Check if a relation should be active or not
   * A relation is inactive if (at least) one case from the relation is discarded
   */
  Relationship.observe('before save', function (context, next) {
    // get instance data
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // cache current persons for future use (after save)
    app.utils.helpers.setValueInContextOptions(context, 'oldParticipants', _.get(data, 'source.existing.persons', []));

    // relation is active, by default
    data.target.active = true;
    // get case IDs from from the relationship
    let caseIds = data.source.all.persons.filter(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE').map(caseRecord => caseRecord.id);
    // if cases were found
    if (caseIds) {
      // find cases
      app.models.case
        .find({
          where: {
            id: {
              inq: caseIds
            }
          }
        })
        .then(function (cases) {
          // if one of the cases is discarded
          cases.forEach(function (caseRecord) {
            if (app.models.case.discardedCaseClassifications.includes(caseRecord.classification)) {
              // set the relation as inactive
              data.target.active = false;
            }
          });
          next();
        });
    } else {
      next();
    }
  });

  /**
   * Update follow-up dates on the contact if the relationship includes a contact
   */
  Relationship.observe('after save', function (context, callback) {
    // prevent infinite loops
    if (app.utils.helpers.getValueFromContextOptions(context, 'triggerPeopleUpdates')) {
      return Promise.resolve();
    }
    // set triggerPeopleUpdates flag to avoid triggering this again on same relationship
    app.utils.helpers.setValueInContextOptions(context, 'triggerPeopleUpdates', true);
    // get created/modified relationship
    let relationship = context.instance;

    // go through the people that are part of the relationship to check if they exists
    const relationshipPersonMap = {};
    const relationshipPersonTypeMap = {};
    let persons = [];
    relationship.persons.forEach(function (person) {
      relationshipPersonTypeMap[person.id] = person.type;
    });

    // load the record
    app.models.person
      .find({
        where: {
          _id: {
            $in: Object.keys(relationshipPersonTypeMap)
          }
        }
      })
      .then(function (records) {
        let convertedPersonFound = false;
        for (const person of records) {
          // keep each person model
          relationshipPersonMap[person.id] = person;
        }

        // validate each person
        relationship.persons.forEach(function (person) {
          if (!Object.keys(relationshipPersonMap[person.id]).length) {
            throw app.logger.error(`Failed to trigger person record updates. Person (id: ${person.id}) not found.`);
          }

          // check type
          if (person.type !== relationshipPersonMap[person.id].type) {
            convertedPersonFound = true;
            person.type = relationshipPersonMap[person.id].type;
          }
          persons.push(person);
        });

        // update persons from relationship
        return convertedPersonFound ?
          relationship.updateAttributes({persons: persons}, context.options) :
          Promise.resolve();
      })
      .then(() => {
        // keep a list of update actions
        const updatePersonRecords = [];
        const mustUpdateNoOfContactsAndExposuresMap = {};
        // go through the people that are part of the relationship
        relationship.persons.forEach(function (person, personIndex) {
          // add to list of records that we need to update number of contacts and exposures
          mustUpdateNoOfContactsAndExposuresMap[person.id] = true;

          // trigger update operations on them (they might have before/after save listeners that need to be triggered on relationship updates)
          updatePersonRecords.push(
            // load the record
            Promise.resolve(relationshipPersonMap[person.id])
              .then(function (personRecord) {
                // if the record is not found, stop with err
                if (!personRecord) {
                  throw app.logger.error(`Failed to trigger person record updates. Person (id: ${person.id}) not found.`);
                }

                personRecord.systemTriggeredUpdate = true;

                // initialize person relationships related payload; will be updated depending on action taken on relationships
                let personRelationships = personRecord.relationshipsRepresentation || [];
                let relationshipsPayload = {};

                if (relationship.deleted) {
                  // remove relationship from relationshipsRepresentation
                  relationshipsPayload = {
                    '$pull': {
                      relationshipsRepresentation: {
                        id: relationship.id
                      }
                    }
                  };

                  // when a relationship is deleted we need to check if the person has additional relationships
                  if (personRelationships.length - 1 > 0) {
                    // person will still have relationships
                    relationshipsPayload['$set'] = {
                      hasRelationships: true
                    };
                  } else {
                    // no relationships remain
                    relationshipsPayload['$set'] = {
                      hasRelationships: false
                    };
                  }
                } else {
                  // relationship just created or updated
                  relationshipsPayload = {
                    '$set': {
                      hasRelationships: true
                    }
                  };

                  // create payload for relationship representations
                  // get other participant
                  let otherParticipant = relationship.persons[personIndex === 0 ? 1 : 0];
                  let relationshipRepresentationPayload = {
                    id: relationship.id,
                    active: relationship.active,
                    otherParticipantType: otherParticipant.type,
                    otherParticipantId: otherParticipant.id,
                    target: person.target,
                    source: person.source
                  };

                  let relationshipIndex = personRelationships.findIndex(rel => rel.id === relationship.id);
                  if (relationshipIndex === -1) {
                    // relationship was not found in current person relationships; add it
                    relationshipsPayload['$addToSet'] = {
                      relationshipsRepresentation: relationshipRepresentationPayload
                    };
                  } else {
                    // relationship already exists; replace its entry from the relationships representation with the new one
                    relationshipsPayload['$set'][`relationshipsRepresentation.${relationshipIndex}`] = relationshipRepresentationPayload;
                  }
                }

                // update
                return personRecord.updateAttributes(relationshipsPayload, context.options);
              })
          );
        });

        // when the relationship is modified the source and target can be changed
        // in this case we need to remove the relationship from the old participant
        // Note: the relationships information is already updated above for the new participants
        if (!context.isNewInstance && !relationship.deleted) {
          let oldParticipants = app.utils.helpers.getValueFromContextOptions(context, 'oldParticipants');
          // loop through the old participants and check if they are still in the relationship
          oldParticipants.forEach(oldPerson => {
            if (!relationship.persons.find(newPerson => newPerson.id === oldPerson.id)) {
              // add to list of records that we need to update number of contacts and exposures
              mustUpdateNoOfContactsAndExposuresMap[oldPerson.id] = true;

              // we need to update the old person
              updatePersonRecords.push(
                // load the record
                Promise.resolve(relationshipPersonMap[oldPerson.id])
                  .then(function (personRecord) {
                    // if the record is not found, stop with err
                    if (!personRecord) {
                      throw app.logger.error(`Failed to trigger person record updates. Person (id: ${oldPerson.id}) not found.`);
                    }
                    personRecord.systemTriggeredUpdate = true;

                    // initialize person relationships related payload; will be updated depending on action taken on relationships
                    let personRelationships = personRecord.relationshipsRepresentation || [];
                    let relationshipsPayload = {
                      // remove relationship from relationshipsRepresentation
                      '$pull': {
                        relationshipsRepresentation: {
                          id: relationship.id
                        }
                      }
                    };

                    // check if the person has additional relationships
                    if (personRelationships.length - 1 > 0) {
                      // person will still have relationships
                      relationshipsPayload['$set'] = {
                        hasRelationships: true
                      };
                    } else {
                      // no relationships remain
                      relationshipsPayload['$set'] = {
                        hasRelationships: false
                      };
                    }

                    // update
                    return personRecord.updateAttributes(relationshipsPayload, context.options);
                  })
              );
            }
          });
        }

        // after finishing updating dates of last contact
        Promise.all(updatePersonRecords)
          // count contacts and exposures ?
          .then(() => {
            // attach update number of contacts and number of exposures requests
            const personsToUpdate = Object.keys(mustUpdateNoOfContactsAndExposuresMap);
            if (personsToUpdate.length < 1) {
              return;
            }

            // get collection name from settings (if defined)
            let collectionName = _.get(app.models.person, 'definition.settings.mongodb.collection');

            // if collection name was not defined in settings
            if (!collectionName) {
              // get it from model name
              collectionName = app.models.person.modelName;
            }

            // get collection
            const collection = app.dataSources.mongoDb.connector.collection(collectionName);
            return collection.updateMany(
              {
                _id: {
                  $in: personsToUpdate
                }
              }, [{
                $set: {
                  numberOfContacts: {
                    $size: {
                      $filter: {
                        input: '$relationshipsRepresentation',
                        as: 'item',
                        cond: {
                          $eq: [
                            '$$item.source',
                            true
                          ]
                        }
                      }
                    }
                  },
                  numberOfExposures: {
                    $size: {
                      $filter: {
                        input: '$relationshipsRepresentation',
                        as: 'item',
                        cond: {
                          $eq: [
                            '$$item.target',
                            true
                          ]
                        }
                      }
                    }
                  }
                }
              }]
            );
          })

          // continue
          .then(function () {
            // get contact representation in the relationship
            let contactInPersons = relationship.persons.find(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');

            // check if the relationship created included a contact
            if (contactInPersons) {
              // trigger update operations on it (might have before/after save listeners that need to be triggered on relationship updates)
              return app.models.contact
                .findOne({
                  where: {
                    id: contactInPersons.id
                  },
                  deleted: true
                })
                .then(function (contactRecord) {
                  // if the record is not found, stop with err
                  if (!contactRecord) {
                    throw app.logger.error(`Failed to trigger contact record updates. Contact (id: ${contactInPersons.id}) not found.`);
                  }
                  contactRecord.systemTriggeredUpdate = true;
                  // trigger record update
                  return contactRecord.updateAttributes({}, context.options);
                })
                .then(function () {
                  callback();
                });
            } else {
              // nothing to do
              callback();
            }
          });
      })
      .catch(callback);
  });

  /**
   * Find or count relationship exposures or contacts for a relationship
   * @param outbreakId
   * @param personId
   * @param [filter]
   * @param [findContacts]
   * @param [onlyCount]
   */
  Relationship.findOrCountPersonRelationshipExposuresOrContacts = function (outbreakId, personId, filter = {}, findContacts = true, onlyCount = false) {
    // get relationship query
    const _relationshipQuery = _.get(filter, 'where.relationship');

    // build default relationship query
    let relationshipQuery = {
      outbreakId: outbreakId,
      persons: {
        elemMatch: {
          id: personId,
          [findContacts ? 'source' : 'target']: true
        }
      }
    };

    // if a relationship query was sent by user
    if (_relationshipQuery) {
      // remove relationship query from the main one
      delete filter.where.relationship;
      // update default relationship query
      relationshipQuery = {
        and: [
          _relationshipQuery,
          relationshipQuery
        ]
      };
    }
    // find all relationships of the specified person where the person is source/target
    return app.models.relationship
      .find({where: relationshipQuery})
      .then(function (relationships) {
        // map relationship models to JSON objects
        relationships = relationships.map((rel) => rel.toJSON());

        // retrieve user information
        return new Promise(function (resolve, reject) {
          // if we just want to count records..then we don't need to retrieve user data
          if (onlyCount) {
            resolve(relationships);
            return;
          }

          // check if we need to retrieve user data
          Relationship.retrieveUserSupportedRelations(
            {
              req: {
                options: {
                  _userRelations: _.map(
                    Relationship.userSupportedRelations,
                    (relName) => ({relation: relName})
                  )
                }
              }
            },
            relationships,
            (err) => {
              // an error occurred ?
              if (err) {
                reject(err);
              }

              // finished mapping user relations
              resolve(relationships);
            }
          );
        }).then((relationships) => {
          // keep a map of people and their relationships
          const personRelationshipMap = {};
          // build a list of other people (in the relationship) IDs
          const otherPeopleIds = [];
          // go through all relationships
          relationships.forEach(function (relationship) {
            // go trough all the people in the relationships
            Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
              // store other person's ID
              if (person.id !== personId) {
                otherPeopleIds.push(person.id);
                // init the map for current person, if not already inited
                if (!personRelationshipMap[person.id]) {
                  personRelationshipMap[person.id] = [];
                }
                // map relationship to current person
                personRelationshipMap[person.id].push(relationship);
              }
            });
          });

          // custom pagination
          const skip = _.get(filter, 'skip', 0);
          delete filter.skip;
          let limit = _.get(filter, 'limit');
          delete filter.limit;

          // build a filer for the other people
          const peopleFilter = app.utils.remote
            .mergeFilters({
              where: {
                outbreakId: outbreakId,
                id: {
                  inq: otherPeopleIds
                }
              },
            }, filter || {});

          // find other people
          return app.models.person
            .find(peopleFilter)
            .then(function (people) {
              // build result
              let result = [];
              // go through all the people
              people.forEach(function (person) {
                // go through all their relations
                if (Array.isArray(personRelationshipMap[person.id])) {
                  personRelationshipMap[person.id].forEach(function (relationship) {
                    // clone person record
                    const record = JSON.parse(JSON.stringify(person));
                    // attach relationship info
                    record.relationship = relationship;
                    // add record to the result
                    result.push(record);
                  });
                }
              });

              if (onlyCount) {
                return result.length;
              }

              // update limit
              if (limit !== undefined) {
                limit = limit + skip;
              }
              // apply pagination if needed
              if (skip !== undefined || limit !== undefined) {
                result = result.slice(skip, limit);
              }
              // return result
              return result;
            });
        });
      });
  };

  /**
   * Find relationship exposures for a person
   * @param outbreakId
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.findPersonRelationshipExposures = function (outbreakId, personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(outbreakId, personId, filter, false);
  };

  /**
   * Count relationship exposures for a person
   * @param outbreakId
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.countPersonRelationshipExposures = function (outbreakId, personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(outbreakId, personId, filter, false, true);
  };

  /**
   * Find relationship contacts for a person
   * @param outbreakId
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.findPersonRelationshipContacts = function (outbreakId, personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(outbreakId, personId, filter);
  };

  /**
   * Count relationship contacts for a person
   * @param outbreakId
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.countPersonRelationshipContacts = function (outbreakId, personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(outbreakId, personId, filter, true, true);
  };

  /**
   * Create a relationship between two people
   * @param outbreakId
   * @param sourceId
   * @param targetId
   * @param relationshipData
   * @param options
   */
  Relationship.createRelationshipBetweenTwoPeople = function (outbreakId, sourceId, targetId, relationshipData, options) {
    // find the source person
    return app.models.person
      .findOne({
        where: {
          id: sourceId,
          outbreakId: outbreakId
        }
      })
      .then(function (sourcePerson) {
        // stop with error if not found
        if (!sourcePerson) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.person.modelName,
            id: sourceId
          });
        }
        // source person must be a case or event
        if (![
          'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT',
          'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
          'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        ].includes(sourcePerson.type)) {
          // otherwise stop with error
          throw app.utils.apiError.getError('INVALID_RELATIONSHIP_SOURCE_TYPE', {
            type: sourcePerson.type,
            allowedTypes: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
          });
        }
        // if the source is a case, it must be a non discarded case
        if (
          sourcePerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' &&
          app.models.case.discardedCaseClassifications.includes(sourcePerson.classification)
        ) {
          // otherwise stop with error
          throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
            id: sourceId
          });
        }

        // find target person
        return app.models.person
          .findOne({
            where: {
              id: targetId,
              outbreakId: outbreakId
            }
          })
          .then(function (targetPerson) {
            // stop with error if not found
            if (!targetPerson) {
              throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                model: app.models.person.modelName,
                id: targetId
              });
            }
            // if the target is a case, it must be a non discarded case
            if (
              targetPerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' &&
              app.models.case.discardedCaseClassifications.includes(targetPerson.classification)
            ) {
              throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
                id: targetId
              });
            }

            // everything went fine, return the two people
            return {
              source: sourcePerson,
              target: targetPerson
            };
          });
      })
      .then(function (people) {
        return new Promise(function (resolve, reject) {
          // create relationship between people
          app.models.outbreak.helpers
            .createPersonRelationship(outbreakId, people.source.id, people.source.type,
              // add target person to relationship data
              Object.assign({}, relationshipData, {persons: [{id: people.target.id}]}), options,
              function (error, result) {
                if (error) {
                  return reject(error);
                }
                resolve(result);
              });
        });
      });
  };

  /**
   * Bulk create relationships
   * @param outbreakId
   * @param sources Source person Ids
   * @param targets Target person Ids
   * @param relationshipData Common relationship data
   * @param options
   * @return {Promise<{created: Array, failed: Array} | never>}
   */
  Relationship.bulkCreate = function (outbreakId, sources, targets, relationshipData, options) {
    // build result
    const result = {
      created: [],
      failed: []
    };
    // keep a list of create relationship actions
    const createRelationships = [];
    // go through all source Ids
    sources.forEach(function (sourceId) {
      // go trough all target Ids
      targets.forEach(function (targetId) {
        // register create relationship action between each source person and each target person
        createRelationships.push(Relationship
          .createRelationshipBetweenTwoPeople(outbreakId, sourceId, targetId, relationshipData, options)
          .then(function (relationship) {
            // store successful result
            result.created.push(relationship);
          })
          .catch(function (error) {
            // store errors
            result.failed.push({
              sourceId: sourceId,
              targetId: targetId,
              error: error
            });
          })
        );
      });
    });
    // create all relationships
    return Promise.all(createRelationships)
      .then(function () {
        // return final result
        return result;
      });
  };

  /**
   * Pre-filter relationships for an outbreak using related models ( person ( case / contact / event ) )
   * @param outbreak
   * @param filter Supports 'where.person' & 'where.followUp' MongoDB compatible queries. For person please include type in case you want to filter only cases, contacts etc.
   * If you include both person & followUp conditions, then and AND will be applied between them.
   * @param options Options from request
   * @return {Promise<void | never>}
   */
  Relationship.preFilterForOutbreak = function (outbreak, filter, options) {
    // set a default filter
    filter = filter || {};

    // get person query, if any
    let personQuery = _.get(filter, 'where.person');

    // if person query found, remove it form main query
    if (personQuery) {
      delete filter.where.person;
    }

    // get follow-up query, if any
    let followUpQuery = _.get(filter, 'where.followUp');

    // if follow-up query found, remove it form main query
    if (followUpQuery) {
      delete filter.where.followUp;
    }

    // get main relationship query
    let relationshipQuery = _.get(filter, 'where');

    // start geographical restriction promise
    return app.models.person
      .addGeographicalRestrictions(options.remotingContext, personQuery)
      .then(geographicalRestrictionsQuery => {
        // initialize promise chain for additional resources filtering
        let buildQuery = Promise.resolve();

        // if a person query is present or geographical restrictions apply
        if (personQuery || geographicalRestrictionsQuery) {
          // restrict query to current outbreak
          personQuery = {
            $and: [
              // if geographical restriction query was constructed it started from person query;
              // use it instead of person query
              geographicalRestrictionsQuery || personQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };
        }

        if (personQuery) {
          // filter person based on query
          buildQuery = buildQuery
            .then(function () {
              return app.models.person
                .rawFind(personQuery, {projection: {_id: 1}})
                .then(function (personRecords) {
                  // build a list of personIds that passed the filter
                  const personIds = [];
                  personRecords.forEach(function (person) {
                    personIds.push(person.id);
                  });
                  return Array.from(new Set(personIds));
                });
            });
        }

        // if a follow-up query is present
        if (followUpQuery) {
          // restrict query to current outbreak
          followUpQuery = {
            $and: [
              followUpQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };

          // filter follow-ups based on query
          buildQuery = buildQuery
            .then((personIds) => {
              // in case we triggered person query and no results were returned, then there is no point in triggering a follow-up query since an AND is applied between these two
              if (
                personIds &&
                personIds.length < 1
              ) {
                return [];
              }

              // either person query returned something, or we didn't call a person query
              return app.models.followUp
                .rawFind(followUpQuery, {projection: {personId: 1}})
                .then(function (followUpRecords) {
                  // did we filter by person as well, then we need to do an intersection between ids which
                  // translates into both person and follow-up conditions must match ?
                  if (!personIds) {
                    personIds = [];
                    followUpRecords.forEach((followUp) => {
                      personIds.push(followUp.personId);
                    });
                  } else {
                    // build a list of personIds that passed the filter
                    const localPersonIds = {};
                    followUpRecords.forEach((followUp) => {
                      localPersonIds[followUp.personId] = true;
                    });

                    // we need to make sure that both conditions match
                    const personIdsTmp = personIds;
                    personIds = [];
                    personIdsTmp.forEach((personId) => {
                      if (localPersonIds[personId]) {
                        personIds.push(personId);
                      }
                    });
                  }

                  // finished => make sure we return unique values
                  return Array.from(new Set(personIds));
                });
            });
        }

        return buildQuery;
      })
      // return relationships
      .then(function (personIds) {
        // if personIds filter present
        if (personIds) {
          // update relationship query to filter based on personIds
          if (_.isEmpty(relationshipQuery)) {
            relationshipQuery = {
              'persons.id': {
                inq: personIds
              }
            };
          } else {
            relationshipQuery = {
              and: [
                relationshipQuery,
                {
                  'persons.id': {
                    inq: personIds
                  }
                }
              ]
            };
          }
        }

        // restrict relationship query to current outbreak
        if (_.isEmpty(relationshipQuery)) {
          relationshipQuery = {
            outbreakId: outbreak.id
          };
        } else {
          relationshipQuery = {
            and: [
              relationshipQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };
        }

        // return updated filter
        return Object.assign(filter, {where: relationshipQuery});
      });
  };

  /**
   * Change source / target for all relationships matching specific conditions
   * @param outbreakId Outbreak Id
   * @param changeSource True if sourceTargetId is source, false otherwise
   * @param sourceTargetId Case / Contact / Event
   * @param where Mongo Query
   * @param options
   */
  Relationship.bulkChangeSourceOrTarget = function (outbreakId, changeSource, sourceTargetId, where, options) {
    // validate input
    // sourceTargetId & where are required
    if (
      _.isEmpty(sourceTargetId) ||
      _.isEmpty(where)
    ) {
      return Promise.reject(app.utils.apiError.getError('VALIDATION_ERROR', {
        model: app.models.relationship.modelName,
        details: 'Where & source / target id are required'
      }));
    }

    // retrieve source / target - case / contact / contact-of-contact / event
    // it must be a valid one, otherwise we need to throw an error
    return app.models.person
      .findById(sourceTargetId)
      .then((sourceTargetModel) => {
        // source / target not found ?
        if (_.isEmpty(sourceTargetModel)) {
          throw app.utils.apiError.getError('VALIDATION_ERROR', {
            model: app.models.relationship.modelName,
            details: 'Source / Target id is invalid'
          });
        }

        // contact of contact can't become source
        if (changeSource && sourceTargetModel.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
          throw app.utils.apiError.getError('CONTACT_OF_CONTACT_CANT_BE_SOURCE');
        }

        // finished
        return sourceTargetModel;
      })
      .then((sourceTargetModel) => {
        // retrieve relationships
        return app.models.relationship
          .find({
            where: app.utils.remote.convertLoopbackFilterToMongo({
              $and: [
                {
                  outbreakId: outbreakId
                },
                where
              ]
            })
          })
          .then((relationships) => {
            return {
              sourceTargetModel: sourceTargetModel,
              relationships: relationships
            };
          });
      })
      .then((data) => {
        // prepare relationships for update
        const updateRelationshipsJobs = [];
        const sourceTargetModel = data.sourceTargetModel;
        const relationships = data.relationships;
        const isolatedContactsData = {};
        relationships.forEach((relationship) => {
          // jump over invalid relationships
          if (
            !relationship.persons ||
            relationship.persons.length !== 2
          ) {
            return;
          }

          // determine source / target person that we need to update
          const clonedPersons = _.cloneDeep(relationship.toJSON().persons);
          const sourceTargetPerson = _.find(
            clonedPersons,
            changeSource ?
              {source: true} :
              {target: true}
          );

          // if same source / target jump over
          if (sourceTargetPerson.id === sourceTargetModel.id) {
            return;
          }

          // make sure we don't leave contact without exposures
          // this might no be need since for contacts we wil move it to an event / case and not to a contact since this isn't possible
          // NOTHING TO DO HERE, a contact will always have an exposure
          // Actually it can, when we change target since target might be a contact, changing it might make the contact isolated
          if (
            !changeSource &&
            sourceTargetPerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          ) {
            // changing target
            // we must determine if we're changing contact relationships
            if (!isolatedContactsData[sourceTargetPerson.id]) {
              isolatedContactsData[sourceTargetPerson.id] = {};
            }
            isolatedContactsData[sourceTargetPerson.id][relationship.id] = true;
          }

          // switch person source / target id
          Object.assign(
            sourceTargetPerson, {
              id: sourceTargetModel.id,
              type: sourceTargetModel.type
            }
          );

          // make sure that at least one of the persons records isn't a contact
          // either sourceTargetId, or the unaltered one
          if (
            clonedPersons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' &&
            clonedPersons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          ) {
            throw app.utils.apiError.getError('CONTACT_CANT_BE_SOURCE');
          }

          // make sure that at least one of the persons records isn't a contact of contact
          // either sourceTargetId, or the unaltered one
          if (
            clonedPersons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT' &&
            clonedPersons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
          ) {
            throw app.utils.apiError.getError('CONTACT_OF_CONTACT_CANT_BE_SOURCE');
          }

          // make sure that we don't have circular relationships, both person records pointing to the same id
          if (clonedPersons[0].id === clonedPersons[1].id) {
            throw app.utils.apiError.getError('CIRCULAR_RELATIONSHIP');
          }

          // create jobs to update relationship source / target
          updateRelationshipsJobs.push((function (relationshipModel, updatedPersons) {
            return (cb) => {
              // update
              relationshipModel
                .updateAttributes({
                  persons: updatedPersons
                }, options)
                .then(() => {
                  // finished
                  cb();
                })
                .catch(cb);
            };
          })(relationship, clonedPersons));
        });

        // finished
        return {
          updateRelationshipsJobs: updateRelationshipsJobs,
          isolatedContactsData: isolatedContactsData
        };
      })
      .then((data) => {
        // we don't need to check for isolated cases ?
        const isolatedContactsData = data.isolatedContactsData;
        if (_.isEmpty(isolatedContactsData)) {
          return data.updateRelationshipsJobs;
        }

        // check for isolated cases
        return app.models.relationship
          .rawFind({
            deleted: false,
            'persons.id': {
              $in: Object.keys(isolatedContactsData)
            }
          }, {
            projection: {
              _id: 1,
              persons: 1
            }
          })
          .then((contactRelationships) => {
            // Retrieve contact id from a relationship ( return undefined if relationships is associated with a contact )
            const getContactId = (persons) => {
              let contactId;
              if (persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                contactId = persons[0].id;
              } else if (persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                contactId = persons[1].id;
              }
              return contactId;
            };

            // go through contacts & determine if one of them will become isolated
            contactRelationships.forEach((relationship) => {
              // do we have other exposures for this contact ?
              const contactId = getContactId(relationship.persons);
              if (
                isolatedContactsData[contactId] &&
                isolatedContactsData[contactId][relationship.id] === undefined
              ) {
                // case has exposure, so it isn't a isolated case anymore
                delete isolatedContactsData[contactId];
              }
            });

            // if we still have isolated contacts after the previous step, then it means that Houston we have a problem
            if (!_.isEmpty(isolatedContactsData)) {
              const contactIds = Object.keys(isolatedContactsData);
              throw app.utils.apiError.getError('DELETE_CONTACT_LAST_RELATIONSHIP', {
                contactIDs: contactIds.join(', '),
                contactIDsArray: contactIds
              });
            }

            // otherwise we're okay to change target / source
            return data.updateRelationshipsJobs;
          });
      })
      .then((updateRelationshipsJobs) => {
        // update source / target for each record
        return new Promise((resolve, reject) => {
          async.parallelLimit(
            updateRelationshipsJobs,
            10,
            function (error) {
              // an error occurred along the way of updating relationships...
              if (!_.isEmpty(error)) {
                return reject(error);
              }

              // finished
              resolve(updateRelationshipsJobs.length);
            }
          );
        });
      });
  };
};
