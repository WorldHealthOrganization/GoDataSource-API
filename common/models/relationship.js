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
   * Build transmission chains from a list of relationships
   * @param relationships {[relationship]}
   * @param callback
   */
  Relationship.getTransmissionChains = function (relationships, callback) {
    transmissionChain.build(relationships, callback);
  };

  /**
   * Count transmission chains from a list of relationships
   * @param relationships {[relationship]}
   * @param callback
   */
  Relationship.countTransmissionChains = function (relationships, callback) {
    transmissionChain.count(relationships, callback);
  };

  /**
   * Filter known transmission chains
   * @param filter
   * @return {*|PromiseLike<T>|Promise<T>}
   */
  Relationship.filterKnownTransmissionChains = function (filter) {
    // transmission chains are formed by case-case relations of non-discarded cases
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          'persons.0.type': 'case',
          'persons.1.type': 'case'
        },
        include: {
          relation: 'people',
          scope: {
            where: {
              classification: {
                inq: [
                  'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED',
                  'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_PROBABLE',
                  'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_SUSPECT'
                ]
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
        return app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, _filter);
      });
  }
};
