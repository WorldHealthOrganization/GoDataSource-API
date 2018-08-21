'use strict';

const _ = require('lodash');
const app = require('../server');

/**
 * Include Custom Relations
 * @param Model
 */
module.exports = function (Model) {

  /**
   * Find custom relations and prepare them for use
   * @param context
   * @param next
   */
  function prepareCustomRelations(context, next) {
    // keep a list of custom relations
    const customRelations = _.get(context, 'options.includeCustom', []);
    // get included relations
    let includeQuery = _.get(context, 'query.include', []);
    // always work with arrays
    includeQuery = Array.isArray(includeQuery) ? includeQuery : [includeQuery];
    // keep a list of normal, loopback-supported filters
    let loopbackIncludeFilter = includeQuery;
    // go through all the relations
    includeQuery.forEach(function (relation) {
      // simple relation inclusion
      if (typeof relation === 'string') {
        // if this is a custom relation
        if (Model.customRelations[relation]) {
          // remove it from the loopback filter
          loopbackIncludeFilter = loopbackIncludeFilter.filter(function (include) {
            return include !== relation;
          });
          // add it to the custom relations
          customRelations.push({
            relation: relation,
            definition: Model.customRelations[relation]
          });
        }
        // complex relation object
      } else if (relation.relation) {
        // if this is a custom relation
        if (Model.customRelations[relation.relation]) {
          // remove it from the loopback filter
          loopbackIncludeFilter = loopbackIncludeFilter.filter(function (include) {
            return include.relation !== relation.relation;
          });
          // add it to the custom relations
          customRelations.push(Object.assign(relation, {definition: Model.customRelations[relation.relation]}));
        }
      }
    });
    // update query include to contain only the relations supported by loopback
    _.set(context, 'query.include', loopbackIncludeFilter);
    // set custom include on the context (use options for 'loaded' event and query for making them available in other contexts such as before/afterRemote)
    _.set(context, 'options.includeCustom', customRelations);
    _.set(context, 'query.includeCustom', customRelations);
    next();
  }

  /**
   * Include custom relations on the model
   * @param context
   * @param modelInstance
   * @return {Promise<[any]>}
   */
  function includeCustomRelations(context, modelInstance) {
    // get custom relations to be included
    let includeCustom = _.get(context, 'options.includeCustom', []);
    let promises = [];
    let foreignKeyContainer, referencedIds;
    // for each relation, build a query based on the relation type
    includeCustom.forEach(function (customRelation) {
      let query;
      switch (customRelation.definition.type) {
        // base model contains a list of references to related model
        case 'belongsToMany':
          query = {
            where: {
              id: {
                inq: _.get(modelInstance, customRelation.definition.foreignKey)
              }
            }
          };
          break;
        // base model contains a list of references to related model
        case 'belongsToManyComplex':
          foreignKeyContainer = modelInstance[customRelation.definition.foreignKeyContainer];
          referencedIds = [];
          // build list of referenced ids
          Array.isArray(foreignKeyContainer) && foreignKeyContainer.forEach(function (property) {
            referencedIds.push(_.get(property, customRelation.definition.foreignKey));
          });
          // build query
          query = {
            where: {
              id: {
                inq: referencedIds
              }
            }
          };
          break;
        // related model contains a list of references to base model
        case 'hasManyEmbedded':
          query = {
            where: {
              [customRelation.definition.foreignKey]: modelInstance.id
            }
          };
          break;
        // related model contains a list of references to base model
        case 'function':
          query = {
            fn: customRelation.definition.fn
          };
          break;
        // other types are not supported
        default:
          throw new Error(`Unsupported custom relation type: ${customRelation.definition.type}`);
      }
      // if a scope was include in the relation
      if (customRelation.scope) {
        // merge it in the query
        query = app.utils.remote.mergeFilters(query, customRelation.scope);
      }
      // regular relation, execute search
      if (customRelation.definition.type !== 'function') {
        // search for the related information
        promises.push(
          app.models[customRelation.definition.model]
            .find(query)
            .then(function (results) {
              modelInstance[customRelation.relation] = results;
            }));
      } else {
        // custom function (promise) execution
        promises.push(
          query.fn(modelInstance)
            .then(function (results) {
              modelInstance[customRelation.relation] = results;
            })
        );
      }
    });
    return Promise.all(promises);
  }

  // if the model has custom relations defined
  if (Model.customRelations) {
    // on access, prepare custom relations
    Model.observe('access', function prepareRelations(context, next) {
      prepareCustomRelations(context, next);
    });

    // on load, include custom relations
    Model.observe('loaded', function includeRelations(context, next) {
      includeCustomRelations(context, context.data)
        .then(function () {
          next();
        })
        .catch(next);
    });
  }
};
