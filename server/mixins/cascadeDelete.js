'use strict';

const app = require('../server');
const async = require('async');
// define a list of available operations
const availableOperationsMap = {
  'delete': require('../../components/workerRunner').bulkModelOperation.deleteOneByOne,
  'restore': require('../../components/workerRunner').bulkModelOperation.restoreOneByOne
};

module.exports = function (Model, options) {

  // by default await for all (cascaded) delete operations to be completed before moving along
  if (options.awaitCompletion === undefined){
    options.awaitCompletion = true;
  }

  /**
   * Run (cascade) operation on monitored relations
   * @param operation
   * @param context
   * @param next
   */
  function runOperation(operation, context, next) {
    // get definitions for all relations (custom ones as well)
    let relationsDefinitions = Object.assign({}, Model.definition.settings.relations || {}, Model.customRelations || {});
    // get model instance id
    let instanceId;
    // try to get it from the instance itself
    if (context.instance && context.instance.id) {
      instanceId = context.instance.id;
      // or from the query params
    } else if (context.where && context.where.id) {
      instanceId = context.where.id;
    }
    // build a list of operations
    let operations = [];
    // if the instance ID was found
    if (instanceId) {
      // go through all monitored relations
      options.relations.forEach(function (relationName) {
        // get relation definition
        let relationDefinition = relationsDefinitions[relationName];
        if (relationDefinition) {
          // handle relations by type
          switch (relationDefinition.type) {
            case 'hasManyEmbedded':
            case 'hasOne':
            case 'hasMany':
              // add operations for each relation
              operations.push(function (callback) {
                availableOperationsMap[operation](relationDefinition.model, {
                  [relationDefinition.foreignKey]: instanceId
                }, function (error, count) {
                  if (error) {
                    // log error
                    app.logger.error(`Cascade ${operation} failed for ${Model.modelName}. Relation ${relationName} ${operation} failed to be cascaded: ${JSON.stringify(error)}`);
                  } else {
                    // log success
                    app.logger.debug(`Cascade ${operation} ${Model.modelName} relation ${relationName} completed successfully. Affected ${count} records`);
                  }
                  // move to the next operation
                  callback(error, count);
                });
              });
              break;
            default:
              // log unhandled relation type
              app.logger.error(`Cascade ${operation} aborted for ${Model.modelName}. Could not handle relation type ${relationDefinition.type} for ${relationName}.`);
              break;
          }
        } else {
          // log unhandled relation definition
          app.logger.error(`Cascade ${operation} aborted for ${Model.modelName}. Could not find relation definition for ${relationName}.`);
        }
      });
    } else {
      // log failure to identify instance id
      app.logger.error(`Cascade ${operation} aborted for ${Model.modelName}. No instance ID found.`);
    }
    // start executing operations (in series)
    async.series(operations, function () {
      // if we need to wait for the operations to complete, move along when everything completed
      if (options.awaitCompletion) {
        next();
      }
    });
    // if there is no need to wait for the operations to complete, just move along
    if (!options.awaitCompletion) {
      next();
    }
  }

  // check there is any relation that needs to be handled
  if (options && options.relations && options.relations.length) {

    // after deleting a model instance
    Model.observe('after delete', function (context, next) {
     runOperation('delete', context, next);
    });

    // after restoring a model instance
    Model.observe('after restore', function (context, next) {
      runOperation('restore', context, next);
    });
  }
};