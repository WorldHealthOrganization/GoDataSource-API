'use strict';

const transmissionChain = require('../../components/workerRunner').transmissionChain;
const app = require('../../server/server');

module.exports = function (Relationship) {
  // set flag to not get controller
  Relationship.hasController = false;

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
   * @param filter
   * @param countOnly
   * @param callback
   */
  Relationship.buildOrCountTransmissionChains = function (outbreakId, filter, countOnly, callback) {
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
          transmissionChain.count(relationships, callback);
        } else {
          // build transmission chain
          transmissionChain.build(relationships, callback);
        }

      })
      .catch(callback);
  };

  /**
   * Build transmission chains for an outbreak
   * @param outbreakId
   * @param filter
   * @param callback
   */
  Relationship.getTransmissionChains = function (outbreakId, filter, callback) {
    Relationship.buildOrCountTransmissionChains(outbreakId, filter, false, callback);
  };

  /**
   * Count transmission chains for an outbreak
   * @param outbreakId
   * @param filter
   * @param callback
   */
  Relationship.countTransmissionChains = function (outbreakId, filter, callback) {
    Relationship.buildOrCountTransmissionChains(outbreakId, filter, true, callback);
  };

  /**
   * Filter known transmission chains
   * @param outbreakId
   * @param filter
   * @return {*|PromiseLike<T>|Promise<T>}
   */
  Relationship.filterKnownTransmissionChains = function (outbreakId, filter) {
    // transmission chains are formed by case-case relations of non-discarded cases
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          'persons.0.type': 'case',
          'persons.1.type': 'case'
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
  }
};
