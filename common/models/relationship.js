'use strict';

const transmissionChain = require('../../components/workerRunner').transmissionChain;
const app = require('../../server/server');

module.exports = function (Relationship) {
  // set flag to not get controller
  Relationship.hasController = false;

  Relationship.fieldLabelsMap = Object.assign({}, Relationship.fieldLabelsMap, {
    persons: 'LNG_RELATIONSHIP_FIELD_LABEL_PERSONS',
    'persons[].type': 'LNG_RELATIONSHIP_FIELD_LABEL_TYPE',
    'persons[].id': 'LNG_RELATIONSHIP_FIELD_LABEL_RELATED_PERSON',
    'persons[].target': 'LNG_RELATIONSHIP_FIELD_LABEL_TARGET',
    'persons[].source': 'LNG_RELATIONSHIP_FIELD_LABEL_SOURCE',
    contactDate: 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE',
    contactDateEstimated: 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE_ESTIMATED',
    certaintyLevelId: 'LNG_RELATIONSHIP_FIELD_LABEL_CERTAINTY_LEVEL',
    exposureTypeId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_TYPE',
    exposureFrequencyId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_FREQUENCY',
    exposureDurationId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_DURATION',
    socialRelationshipTypeId: 'LNG_RELATIONSHIP_FIELD_LABEL_RELATION',
    clusterId: 'LNG_RELATIONSHIP_FIELD_LABEL_CLUSTER',
    comment: 'LNG_RELATIONSHIP_FIELD_LABEL_COMMENT'
  });

  Relationship.referenceDataFieldsToCategoryMap = {
    certaintyLevelId: 'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL',
    exposureTypeId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
    exposureFrequencyId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
    exposureDurationId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION',
    socialRelationshipTypeId: 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION'
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

  Relationship.relatedFieldLabelsMap = {
    'person': 'LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON'
  };

  Relationship.printFieldsinOrder = [
    'contactDate',
    'contactDateEstimated',
    'certaintyLevelId',
    'exposureTypeId',
    'exposureFrequencyId',
    'exposureDurationId',
    'socialRelationshipTypeId',
    'comment',
    'person'
  ];
  /**
   * Build or count transmission chains for an outbreak
   * @param outbreakId
   * @param followUpPeriod
   * @param filter
   * @param countOnly
   * @param callback
   */
  Relationship.buildOrCountTransmissionChains = function (outbreakId, followUpPeriod, filter, countOnly, callback) {
    // build a filter: get all relations between non-discarded cases and contacts + events from current outbreak
    filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId
        },
        include: {
          relation: 'people',
          scope: {
            where: {
              or: [
                {
                  type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  classification: {
                    inq: app.models.case.nonDiscardedCaseClassifications
                  }
                },
                {
                  type: {
                    inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                  }
                }
              ]
            },
            filterParent: true
          }
        }
      }, filter || {});

    // search relations
    app.models.relationship
      .find(filter)
      .then(function (relationships) {
        // add 'filterParent' capability
        relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, filter);
        if (countOnly) {
          // count transmission chain
          transmissionChain.count(relationships, followUpPeriod, callback);
        } else {
          // build transmission chain
          transmissionChain.build(relationships, followUpPeriod, callback);
        }

      })
      .catch(callback);
  };

  /**
   * Build transmission chains for an outbreak
   * @param outbreakId
   * @param followUpPeriod
   * @param filter
   * @param callback
   */
  Relationship.getTransmissionChains = function (outbreakId, followUpPeriod, filter, callback) {
    Relationship.buildOrCountTransmissionChains(outbreakId, followUpPeriod, filter, false, callback);
  };

  /**
   * Count transmission chains for an outbreak
   * @param outbreakId
   * @param followUpPeriod
   * @param filter
   * @param callback
   */
  Relationship.countTransmissionChains = function (outbreakId, followUpPeriod, filter, callback) {
    Relationship.buildOrCountTransmissionChains(outbreakId, followUpPeriod, filter, true, callback);
  };

  /**
   * Filter known transmission chains
   * @param outbreakId
   * @param filter
   * @return {*|PromiseLike<T>|Promise<T>} Promise that resolves a list of relationships
   */
  Relationship.filterKnownTransmissionChains = function (outbreakId, filter) {
    // transmission chains are formed by case-case relations of non-discarded cases
    let _filter = app.utils.remote
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
            where: {
              classification: {
                inq: app.models.case.nonDiscardedCaseClassifications
              }
            },
            filterParent: true
          }
        }
      }, filter || {});

    // find relationships
    return Relationship
      .find(_filter)
      .then(function (relationships) {
        return app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, _filter)
        // some relations may be invalid after applying scope filtering, remove invalid ones
          .filter(function (relationship) {
            return relationship.people.length === 2;
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
     * @param callback
     */
    build: function (relationships, followUpPeriod, callback) {
      transmissionChain.build(relationships, followUpPeriod, callback);
    },
    /**
     * Count transmission chains
     * @param relationships
     * @param followUpPeriod
     * @param callback
     */
    count: function (relationships, followUpPeriod, callback) {
      transmissionChain.build(relationships, followUpPeriod, callback);
    }
  };

  /**
   * Get all cases and list of contacts per case (only IDs)
   * Also count cases and contacts linked to cases
   * @param outbreakId
   * @param filter
   */
  Relationship.getCasesWithContacts = function (outbreakId, filter) {
    // initialize result
    let result = {
      casesCount: 0,
      contactsCount: 0,
      // map of cases to contact details
      cases: {}
    };

    // get all relationships between cases and contacts
    return app.models.relationship
      .find(app.utils.remote
        .mergeFilters({
          where: {
            outbreakId: outbreakId,
            and: [
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'},
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'}
            ]
          }
        }, filter || {})
      )
      .then(function (relationships) {
        relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, filter);

        // initialize contacts map and caseContactsMap
        // helper properties to keep the contacts already counted
        let contactsMap = {};
        let caseContactsMap = {};

        // loop through the relationships and populate the casesMap;
        // Note: This loop will only add the cases that have relationships. Will need to do another query to get the cases without relationships
        relationships.forEach(function (relationship) {
          // get case index from persons
          let caseIndex = relationship.persons.findIndex(elem => elem.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE');
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

        // Note: in order to get the full results we need to also get the cases that don't have contacts
        // however if the filter included a scope filter for the "people" relation, the cases were filtered so no need to get cases that don't have relationships
        // checking if a filter was sent for cases
        // initialize casesFiltered flag
        let casesFiltered = false;
        if (filter && filter.include) {
          // normalize filter.include
          let includeFilter = Array.isArray(filter.include) ? filter.include : [filter.include];
          // checking for an include item that has relation = people and has a scope
          casesFiltered = includeFilter.findIndex(function (relation) {
            return typeof relation === 'object' && relation.relation === 'people' && relation.scope;
          }) !== -1;
        }

        if (!casesFiltered) {
          // get cases without relationships
          return app.models.case.find({
            where: {
              outbreakId: outbreakId,
              id: {
                nin: Object.keys(result.cases)
              }
            },
            fields: {
              id: true
            }
          });
        } else {
          // no need to query for other cases; sending empty array to not affect result
          return [];
        }
      })
      .then(function (cases) {
        // loop through the found cases and add them to the result
        cases.forEach(function (item) {
          result.cases[item.id] = {
            id: item.id,
            contactsCount: 0,
            contactIDs: []
          };

          // increase total counter
          result.casesCount++;
        });

        // return the entire result
        return result;
      });
  };

  /**
   * Check if a relation should be active or not
   * A relation is inactive if (at least) one case from the relation is discarded
   */
  Relationship.observe('before save', function (context, next) {
    // get instance data
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
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
            if (!app.models.case.nonDiscardedCaseClassifications.includes(caseRecord.classification)) {
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

    // keep a list of update actions
    const updatePersonRecords = [];
    // go through the people that are part of the relationship
    relationship.persons.forEach(function (person) {
      // trigger update operations on them (they might have before/after save listeners that need to be triggered on relationship updates)
      updatePersonRecords.push(
        // load the record
        app.models.person
          .findById(person.id)
          .then(function (personRecord) {
            // if the record is not found, stop with err
            if (!personRecord) {
              throw app.logger.error(`Failed to trigger person record updates. Person (id: ${person.id}) not found.`);
            }
            // trigger record update
            return personRecord.updateAttributes({}, context.options);
          })
      );
    });

    // after finishing updating dates of last contact
    Promise.all(updatePersonRecords)
      .then(function () {
        // get contact representation in the relationship
        let contactInPersons = relationship.persons.find(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');

        // check if the relationship created included a contact
        if (contactInPersons) {
          // trigger update operations on it (might have before/after save listeners that need to be triggered on relationship updates)
          return app.models.contact
            .findById(contactInPersons.id)
            .then(function (contactRecord) {
              // if the record is not found, stop with err
              if (!contactRecord) {
                throw app.logger.error(`Failed to trigger contact record updates. Contact (id: ${contactInPersons.id}) not found.`);
              }
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
      })
      .catch(callback);
  });


  /**
   * Find chains of relations that include the specified people ids. Chains of relations mean all relations of the
   * people specified in the peopleIds, and the relations of their related people, and so on until no more relations found (chain is completed)
   * @param outbreakId
   * @param peopleIds
   * @param foundRelationshipIds
   * @return {*|PromiseLike<T | never>|Promise<T | never>}
   */
  Relationship.findRelationshipChainsForPeopleIds = function (outbreakId, peopleIds, foundRelationshipIds = []) {
    // define a relationships map (indexed list of relationship ids)
    const relationshipMap = {};
    // find all relations that were not previously found that match the criteria
    return Relationship
      .find({
        fields: ['id', 'persons'],
        where: {
          'persons.id': {
            inq: peopleIds
          },
          outbreakId: outbreakId,
          id: {
            nin: foundRelationshipIds
          }
        }
      })
      .then(function (relationships) {
        // keep a list of new people
        const newPeopleIds = [];
        // if new relationships found
        if (relationships.length) {
          // go through all relationships
          relationships.forEach(function (relationship) {
            // map relationship as found
            relationshipMap[relationship.id] = true;
            // get people ids
            if (Array.isArray(relationship.persons)) {
              relationship.persons.forEach(function (person) {
                // don't include people already included in previous search
                if (!peopleIds.includes(person.id)) {
                  newPeopleIds.push(person.id);
                }
              });
            }
          });
          // find all relationships of the related people (that were not found previously)
          return Relationship
            .findRelationshipChainsForPeopleIds(outbreakId, newPeopleIds, [...foundRelationshipIds, ...Object.keys(relationshipMap)])
            .then(function (foundRelationshipMap) {
              Object.assign(relationshipMap, foundRelationshipMap);
              // return the complete map of relationships
              return relationshipMap;
            });
          // no more new relationships found
        } else {
          // return the list
          return relationshipMap;
        }
      });
  };

  /**
   * Find transmission chains which include people that matched the filter
   * @param outbreakId
   * @param followUpPeriod
   * @param filter
   * @return {PromiseLike<T | never>}
   */
  Relationship.findTransmissionChainsForFilteredPeople = function (outbreakId, followUpPeriod, filter) {
    // find people that matched the filter
    return app.models.person
      .find(filter)
      .then(function (people) {
        // find relationship chains for the matched people
        return Relationship.findRelationshipChainsForPeopleIds(outbreakId, people.map(person => person.id));
      })
      .then(function (relationshipMap) {
        // build transmission chains based on the relationship chains
        return new Promise(function (resolve, reject) {
          Relationship.buildOrCountTransmissionChains(outbreakId, followUpPeriod, {where: {id: {inq: Object.keys(relationshipMap)}}}, false, function (error, chains) {
            if (error) {
              return reject(error);
            }
            return resolve(chains);
          });
        });
      });
  };

  /**
   * Find or count relationship exposures or contacts for a relationship
   * @param personId
   * @param [filter]
   * @param [isSource]
   * @param [onlyCount]
   */
  Relationship.findOrCountPersonRelationshipExposuresOrContacts = function (personId, filter = {}, isSource = true, onlyCount = false) {
    // find all relationships of the specified person where the person is source/target
    return app.models.relationship
      .find(app.utils.remote
        .mergeFilters({
          where: {
            persons: {
              elemMatch: {
                id: personId,
                [isSource ? 'source' : 'target']: true
              }
            }
          },
        }, filter.relationships || {})
      )
      .then(function (relationships) {
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
        // build a filer for the other people
        const peopleFilter = app.utils.remote
          .mergeFilters({
            where: {
              id: {
                inq: otherPeopleIds
              }
            },
          }, filter || {});

        // check if only need to count
        if (onlyCount) {
          return app.models.person
            .count(peopleFilter.where);
        }

        // find other people
        return app.models.person
          .find(peopleFilter)
          .then(function (people) {
            // go through all the people
            people.forEach(function (person) {
              // attach relationships information to every person
              person.relationships = personRelationshipMap[person.id];
            });
            return people;
          });
      });
  };

  /**
   * Find relationship exposures for a person
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.findPersonRelationshipExposures = function (personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(personId, filter, false);
  };

  /**
   * Count relationship exposures for a person
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.countPersonRelationshipExposures = function (personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(personId, filter, false, true);
  };

  /**
   * Find relationship contacts for a person
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.findPersonRelationshipContacts = function (personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(personId, filter);
  };

  /**
   * Count relationship contacts for a person
   * @param personId
   * @param filter
   * @return {*}
   */
  Relationship.countPersonRelationshipContacts = function (personId, filter) {
    return Relationship.findOrCountPersonRelationshipExposuresOrContacts(personId, filter, true, true);
  };
};
