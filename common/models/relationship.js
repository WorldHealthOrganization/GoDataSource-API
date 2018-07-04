'use strict';

const transmissionChain = require('../../components/workerRunner').transmissionChain;

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
   * @param followUpPeriod
   * @param callback
   */
  Relationship.getTransmissionChains = function (relationships, followUpPeriod, callback) {
    transmissionChain.build(relationships, followUpPeriod, callback);
  };

  /**
   * Count transmission chains from a list of relationships
   * @param relationships {[relationship]}
   * @param followUpPeriod
   * @param callback
   */
  Relationship.countTransmissionChains = function (relationships, followUpPeriod, callback) {
    transmissionChain.count(relationships, followUpPeriod, callback);
  };
};
