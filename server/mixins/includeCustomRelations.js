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
    const customRelations = [];
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
    // set custom include on the context
    _.set(context, 'options.includeCustom', customRelations);
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
    // for each relation, build a query based on the relation type
    includeCustom.forEach(function (customRelation) {
      let query;
      switch (customRelation.definition.type) {
        // base model contains a list of references to related model
        case 'belongsToMany':
          query = {
            where: {
              id: {
                inq: modelInstance[customRelation.definition.foreignKey]
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
        // other types are not supported
        default:
          throw new Error(`Unsupported custom relation type: ${customRelation.definition.type}`);
      }
      // if a scope was include in the relation
      if (customRelation.scope) {
        // merge it in the query
        query = app.utils.remote.mergeFilters(query, customRelation.scope);
      }
      // search for the related information
      promises.push(
        app.models[customRelation.definition.model]
          .find(query)
          .then(function (results) {
            modelInstance[customRelation.relation] = results;
          }));
    });
    return Promise.all(promises);
  }

  // if the model has custom relations defined
  if (Model.customRelations) {
    // on access, prepare custom relations
    Model.observe('access', function p(context, next){
      prepareCustomRelations(context, next);
    });

    // on load, include custom relations
    Model.observe('loaded', function z(context, next){
      includeCustomRelations(context, context.data)
        .then(function () {
          next();
        })
        .catch(next);
    });
  }
};
