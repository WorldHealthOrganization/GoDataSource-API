'use strict';

const _ = require('lodash');
const app = require('../../server/server');

module.exports = function (Cluster) {
  // set flag to not get controller
  Cluster.hasController = false;

  /**
   * Find people in a cluster
   * @param filter
   * @param callback
   */
  Cluster.prototype.findPeople = function (filter, callback) {

    // define default relationship filter
    let relationshipFilter = {
      fields: ['id', 'persons'],
      where: {
        clusterId: this.id,
      }
    };

    // read relationship filter from the main filter
    if (filter) {
      const _relationshipFilter = _.get(filter, 'relationship');
      // if a filter was sent
      if (_relationshipFilter) {
        // merge the default filter with the one that was sent
        relationshipFilter = app.utils.remote
          .mergeFilters(relationshipFilter, _relationshipFilter);
      }
    }

    // find relationships that match the filter
    app.models.relationship
      .find(relationshipFilter)
      .then(function (relationships) {
        const peopleIds = [];
        // go through the relationships and gather people ids
        relationships.forEach((relationship) => {
          // should always be an array, but double-check for corrupted data
          Array.isArray(relationship.persons) && relationship.persons.forEach((person) => {
            peopleIds.push(person.id);
          });
        });
        return peopleIds;
      })
      .then(function (peopleIds) {
        // find people that match the filter and belong to the relationships matched earlier
        return app.models.person
          .find(app.utils.remote.mergeFilters(
            {
              where: {
                id: {
                  inq: peopleIds
                }
              }
            },
            filter || {}));
      })
      .then(function (people) {
        callback(null, people);
      })
      .catch(callback);
  };
};
