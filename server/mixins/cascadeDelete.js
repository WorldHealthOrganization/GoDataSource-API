'use strict';

const app = require('../server');
const async = require('async');
const bulkDelete = require('../../components/workerRunner').bulkModelOperation.deleteOneByOne;

module.exports = function (Model, options) {
  if (options.awaitCompletion === undefined){
    options.awaitCompletion = true;
  }
  if (options && options.relations && options.relations.length) {
    Model.observe('after delete', function (context, next) {
      let relationsDefinitions = Object.assign({}, Model.definition.settings.relations || {}, Model.customRelations || {});

      let instanceId;
      if (context.instance && context.instance.id) {
        instanceId = context.instance.id;
      } else if (context.where && context.where.id) {
        instanceId = context.where.id;
      }

      let operations = [];
      if (instanceId) {
        options.relations.forEach(function (relationName) {
          let relationDefinition = relationsDefinitions[relationName];
          if (relationDefinition) {
            switch (relationDefinition.type) {
              case 'hasManyEmbedded':
              case 'hasOne':
              case 'hasMany':
                options.push(function (callback) {
                  bulkDelete(relationDefinition.model, {
                    [relationDefinition.foreignKey]: instanceId
                  }, function (error, count) {
                    if (error) {
                      app.logger.error(`Cascade delete failed for ${Model.modelName}. Relation ${relationName} delete failed to be cascaded: ${JSON.stringify(error)}`);
                    } else {
                      app.logger.debug(`Cascade delete ${Model.modelName} relation ${relationName} completed successfully. Deleted ${count} records`);
                    }
                    callback(error, count);
                  });
                });
                break;
              default:
                app.logger.error(`Cascade delete aborted for ${Model.modelName}. Could not handle relation type ${relationDefinition.type} for ${relationName}.`);
                break;
            }
          } else {
            app.logger.error(`Cascade delete aborted for ${Model.modelName}. Could not find relation definition for ${relationName}.`);
          }
        });
      } else {
        app.logger.error(`Cascade delete aborted for ${Model.modelName}. No instance ID found.`);
      }
      async.series(operations, function () {
        if (options.awaitCompletion) {
          next();
        }
      });
      if (!options.awaitCompletion) {
        next();
      }
    });
  }
};
