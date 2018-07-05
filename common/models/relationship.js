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

  Relationship.filterKnownTransmissionChains = function (filter) {
    return Relationship
      .find(app.utils.remote
        .mergeFilters({
          where: {
            "persons.0.type": "case",
            "persons.1.type": "case"
          }
        }, filter || {}))
  }
};
