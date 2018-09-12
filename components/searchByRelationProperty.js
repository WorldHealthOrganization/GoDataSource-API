'use strict';

const _ = require('lodash');


/**
 * Filter results by related model properties
 * Applying a filter on related model properties Loopback only filters the related model inclusion in the result
 * This hook removes from the result the items that don't contain the filtered related model if the relation scope.filterParent flag is sent and true
 * eg filter: {
 *      "include": [
 *        {
 *          "relation": "role",
 *          "scope": {
 *            "where": {"name": "System Administrator"},
 *            "filterParent": true
 *          }
 *        },
 *        {
 *          "relation": "accessTokens"
 *        }
 *      ]
 *    }
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
  if (model && typeof model.toJSON === 'function') {
    model = model.toJSON();
  }
  // if the model does not exist or no filter, stop here
  if (!model || !filter) {
    return model;
  }
  // get standard include filter
  let include = _.get(filter, 'include', []);
  // get custom include filter
  let includeCustom = _.get(filter, 'includeCustom', []);
  // standard include filter may not always be an array
  if (!Array.isArray(include)) {
    include = [include];
  }
  // merge the two filters
  include = include.concat(includeCustom);

  // include same relation only once
  const includedRelNames = [];
  // go through all relations
  include = include.filter(function (relation) {
    // get relation name
    let relationName;
    if (typeof relation === 'string') {
      relationName = relation;
    } else {
      relationName = relation.relation;
    }
    // if the relation was not included, include it now
    if (includedRelNames.indexOf(relationName) === -1) {
      includedRelNames.push(relationName);
      return true;
    }
    // otherwise skip it
    return false;
  });

  // update filter property
  filter.include = include;
  // process each filter
  filter.include.forEach(function (include) {
    // if the include filter has a scope
    if (model && include.relation && include.scope) {
      // perform the search (apply filtering)
      model[include.relation] = deepSearchByRelationProperty(model[include.relation], include.scope);
      // if the parent needs to be filtered and the relation was not found, clear the parent (set null)
      if (include.scope.filterParent && (!model[include.relation] || (Array.isArray(model[include.relation]) && !model[include.relation].length))) {
        model = null;
      }
    }
  });
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
    });
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
  Model.beforeRemote(remote, function (context, model, next) {
    // native pagination is incompatible with filter search by relation property
    const skip = _.get(context, 'args.filter.skip');
    const limit = _.get(context, 'args.filter.limit');
    // store skip for custom pagination
    if (skip !== undefined) {
      // remove skip from native pagination
      delete context.args.filter.skip;
      _.set(context, 'args.filter._deep.skip', skip);
    }
    // store limit for custom pagination
    if (limit !== undefined) {
      // remove limit from native pagination
      delete context.args.filter.limit;
      _.set(context, 'args.filter._deep.limit', limit);
    }
    next();
  });

  /**
   * Attach the behavior on specified remote
   */
  Model.afterRemote(remote, function (context, model, next) {
    // overwrite the found results
    context.result = deepSearchByRelationProperty(context.result, _.get(context, 'args.filter', {}));
    // custom pagination
    const skip = _.get(context, 'args.filter._deep.skip', 0);
    let limit = _.get(context, 'args.filter._deep.limit');
    if (limit !== undefined) {
      limit = limit + skip;
    }
    context.result = context.result.slice(skip, limit);
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
