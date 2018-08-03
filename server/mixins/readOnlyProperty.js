'use strict';

const app = require('../server');
const readReadOnlyProperties = {};

/**
 * Add support for 'readOnly' keyword in the list of properties.
 * Removes properties marked as readonly form request data for create and prototype.updateAttributes
 * Also stores a list of properties that is safe for import (marked as non-readonly or safeForImport)
 * @param Model
 */
module.exports = function (Model) {

  if (!readReadOnlyProperties[Model.modelName]) {
    readReadOnlyProperties[Model.modelName] = [];
    Model._importableProperties = [];
  }

  // cache model read-only properties
  Model.forEachProperty(function (propertyName) {
    if (Model.definition.properties[propertyName].readOnly) {
      readReadOnlyProperties[Model.modelName].push(propertyName);
      // property may be readOnly in the API but safe to import from a file
      if (Model.definition.properties[propertyName].safeForImport) {
        Model._importableProperties.push(propertyName);
      }
    } else {
      // non-readOnly properties are importable
      Model._importableProperties.push(propertyName);
    }
  });

  /**
   * Remove readonly properties from an object
   * @param instanceData
   */
  Model.removeReadOnlyProperties = function (instanceData) {
    Object.keys(instanceData).forEach(function (propertyName) {
      if (readReadOnlyProperties[Model.modelName].indexOf(propertyName) !== -1) {
        delete instanceData[propertyName];
      }
    })
  };

  /**
   * Remove readonly properties on create
   */
  Model.beforeRemote('create', function (context, modelInstance, next) {
    Model.removeReadOnlyProperties(context.args.data);
    next();
  });

  /**
   * Remove readonly properties on prototype.patchAttributes (update)
   */
  Model.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    Model.removeReadOnlyProperties(context.args.data);
    next();
  });

  /**
   * Remove readonly properties from create/update via relations also
   */
  Object.keys(Model.definition.settings.relations).forEach(function (relationName) {
    const relation = Model.definition.settings.relations[relationName];

    // handle only 'has'-type of relations, belongsTo does not apply
    if (relation.type.startsWith('has')) {
      const modelName = relation.model;

      // handle create
      Model.beforeRemote(`prototype.__create__${relationName}`, function (context, modelInstance, next) {
        if (typeof app.models[modelName].removeReadOnlyProperties === 'function') {
          app.models[modelName].removeReadOnlyProperties(context.args.data);
        }
        return next();
      });

      // handle update
      Model.beforeRemote(`prototype.__updateById__${relationName}`, function (context, modelInstance, next) {
        if (typeof app.models[modelName].removeReadOnlyProperties === 'function') {
          app.models[modelName].removeReadOnlyProperties(context.args.data);
        }
        return next();
      });
    }
  });
};
