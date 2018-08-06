'use strict';

const transmissionChain = require('../../components/workerRunner').transmissionChain;
const app = require('../../server/server');

module.exports = function (Relationship) {
  // set flag to not get controller
  Relationship.hasController = false;

  Relationship.fieldLabelsMap = {
    'persons[].type': 'LNG_RELATIONSHIP_FIELD_LABEL_TYPE',
    'persons[].id': 'LNG_RELATIONSHIP_FIELD_LABEL_RELATED_PERSON',
    contactDate: 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE',
    contactDateEstimated: 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE_ESTIMATED',
    certaintyLevelId: 'LNG_RELATIONSHIP_FIELD_LABEL_CERTAINTY_LEVEL',
    exposureTypeId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_TYPE',
    exposureFrequencyId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_FREQUENCY',
    exposureDurationId: 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_DURATION',
    socialRelationshipTypeId: 'LNG_RELATIONSHIP_FIELD_LABEL_RELATION',
    clusterId: 'LNG_RELATIONSHIP_FIELD_LABEL_CLUSTER',
    comment: 'LNG_RELATIONSHIP_FIELD_LABEL_COMMENT'
  };

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
                  type: 'case',
                  classification: {
                    inq: app.models.case.nonDiscardedCaseClassifications
                  }
                },
                {
                  type: {
                    inq: ['contact', 'event']
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
            inq: ['case', 'event']
          },
          'persons.1.type': {
            inq: ['case', 'event']
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
    return app.models.relationship.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          and: [
            {'persons.type': 'contact'},
            {'persons.type': 'case'}
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
          let caseIndex = relationship.persons.findIndex(elem => elem.type === 'case');
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
  }
};
