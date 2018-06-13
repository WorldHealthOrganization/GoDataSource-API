'use strict';

const _ = require('lodash');

/**
 * Search by relation property
 * @param Model
 */
module.exports = function (Model) {
  /**
   * Filter results by related model properties
   * Applying a filter on related model properties Loopback only filters the related model inclusion in the result
   * This hook removes from the result the items that don't contain the filtered related model if the relation scope.filterParent flag is sent and true
   * eg filter: {
        "include": [
          {
            "relation": "role",
            "scope": {
              "where": {"name": "System Administrator"},
              "filterParent": true
            }
          },
          {
            "relation": "accessTokens"
          }
        ]
      }
   * Based on the above example the hook removes the entries that don't contain the embedded role model (this is already filtered by Loopback)
   */
  Model.afterRemote('find', function (context, models, next) {
    // check for include filter
    let includeFilter = _.get(context, 'args.filter.include', []);
    // normalize the include filter as an array
    includeFilter = Array.isArray(includeFilter) ? includeFilter : [includeFilter];

    // get from the include filter the properties that need to be checked for each item in the result; these are the 'relation' values from each item in the includeFilter that has a scope.where clause
    let props = [];
    props = includeFilter.map(function (rel) {
      return rel.scope && rel.scope.filterParent ? rel.relation : null;
    }).filter(function (rel) {
      return rel !== null;
    });

    // initialize the new results list
    let results = [];

    // check is there are properties to be checked in each model instance
    if (props.length) {
      // get from the models list only the ones that contain all the props
      results = models.filter(function (model) {
        model = model.toJSON();
        return props.filter(function (prop) {
          return !!model[prop];
        }).length === props.length;
      });
    } else {
      results = models;
    }

    // overwrite the found results
    context.result = results;

    next();
  })
};
