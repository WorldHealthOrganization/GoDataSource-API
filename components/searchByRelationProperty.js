'use strict';

const _ = require('lodash');


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


/**
 * Search recursively through the nested relations, based on 'filterParent' parameter, decide if a record should be included when the relation is empty
 * @param model
 * @param filter
 * @return {*}
 */
function deepSearchByRelationPropertyOnModel(model, filter) {
  // always work with JSON to be able to traverse relation data
  if (typeof model.toJSON === 'function') {
    model = model.toJSON();
  }
  // check if there's a filter
  if (filter.include) {
    // always use arrays (normalize filters)
    if (!Array.isArray(filter.include)) {
      filter.include = [filter.include];
    }
    filter.include.forEach(function (include) {
      // if the include filter has a scope
      if (include.relation && include.scope) {
        // perform the search (apply filtering)
        model[include.relation] = deepSearchByRelationProperty(model[include.relation], include.scope);
        // if the parent needs to be filtered and the relation was not found, clear the parent (set null)
        if (include.scope.filterParent && (!model[include.relation] || (Array.isArray(model[include.relation]) && !model[include.relation].length))) {
          model = null;
        }
      }
    });
  }
  return model;
}

/**
 * Search recursively through the nested relations of a model or list of models, based on 'filterParent' parameter,
 * decide if a record should be included when the relation is empty
 * @param resource
 * @param filter
 * @return {*}
 */
function deepSearchByRelationProperty(resource, filter) {
  let result;
  // array of resources
  if (Array.isArray(resource)) {
    result = [];
    // handle each resource separately
    resource.forEach(function (singleResource) {
      // perform the search (apply filtering)
      let res = deepSearchByRelationPropertyOnModel(singleResource, filter);
      if (res) {
        result.push(res);
      }
    })
  } else {
    // single element, perform search
    result = deepSearchByRelationPropertyOnModel(resource, filter);
  }
  return result;
}

/**
 * Attach behavior or a Model remote
 * @param Model
 * @param remote
 */
function attachOnRemote(Model, remote) {
  /**
   * Attach the behavior on specified remote
   */
  Model.afterRemote(remote, function (context, model, next) {
    // check for include filter
    let includeFilter = _.get(context, 'args.filter.include', []);
    // also include custom relations
    includeFilter = includeFilter.concat(_.get(context, 'args.filter.includeCustom', []));
    // normalize the include filter as an array
    includeFilter = Array.isArray(includeFilter) ? includeFilter : [includeFilter];
    // overwrite the found results
    context.result = deepSearchByRelationProperty(context.result, {include: includeFilter});
    next();
  });
}

module.exports = {
  /**
   * Attach the behavior on a list of remotes that belong to a Model
   * @param model
   * @param remotes
   */
  attachOnRemotes: function (model, remotes) {
    if (!Array.isArray(remotes)) {
      remotes = [remotes];
    }
    remotes.forEach(function (remote) {
      attachOnRemote(model, remote);
    });
  },
  deepSearchByRelationProperty: deepSearchByRelationProperty
};
