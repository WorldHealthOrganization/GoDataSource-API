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

  /**
   * Get Model importable properties (max 2 levels deep)
   * @param Model
   * @param prefix This represents the parent property path
   * @return {Array}
   */
  function getImportableProperties(Model, prefix) {
    // store a list of importable properties
    let importableProperties = [];
    Model.forEachProperty(function (propertyName) {
      // non-readOnly properties are importable
      // readOnly properties are importable only if marked as safe for import
      if (
        Model.definition.properties[propertyName].readOnly && Model.definition.properties[propertyName].safeForImport ||
        !Model.definition.properties[propertyName].readOnly
      ) {
        // complex model type
        if (Model.definition.properties[propertyName].type && Model.definition.properties[propertyName].type.definition) {
          // do not parse more than 2 levels (we don't need that level of granularity when importing flat files)
          if (prefix || Model.definition.properties[propertyName].importTopLevelOnly) {
            if (prefix) {
              propertyName = `${prefix}.${propertyName}`;
            }
            importableProperties.push(propertyName);
            return importableProperties;
          }
          // get next level of importable properties and merge the results
          importableProperties = importableProperties.concat(getImportableProperties(Model.definition.properties[propertyName].type, propertyName));
        }
        // array of types
        if (Array.isArray(Model.definition.properties[propertyName].type)) {
          // array of complex model types
          if (Model.definition.properties[propertyName].type[0].definition) {
            // do not parse more than 2 levels (we don't need that level of granularity when importing flat files)
            if (prefix || Model.definition.properties[propertyName].importTopLevelOnly) {
              if (prefix) {
                propertyName = `${prefix}.${propertyName}`;
              }
              importableProperties.push(propertyName);
              return importableProperties;
            }
            // get next level of importable properties and merge the results
            importableProperties = importableProperties.concat(getImportableProperties(Model.definition.properties[propertyName].type[0], `${propertyName}[]`));
            // array of simple types
          } else {
            // keep a copy of original property name
            const originalPropertyName = propertyName;
            // update property name if needed
            if (prefix) {
              propertyName = `${prefix}.${propertyName}`;
            }
            if (!Model.definition.properties[originalPropertyName].importTopLevelOnly) {
              // mark property as an array
              propertyName = `${propertyName}[]`;
            }
            // add it to the list of properties
            importableProperties.push(propertyName);
          }
        } else {
          // update property name if needed
          if (prefix) {
            propertyName = `${prefix}.${propertyName}`;
          }
          // add it to the list of properties
          importableProperties.push(propertyName);
        }
      }
    });
    // return the list of importable properties
    return importableProperties;
  }

  if (!readReadOnlyProperties[Model.modelName]) {
    readReadOnlyProperties[Model.modelName] = [];
  }

  // cache model read-only properties
  Model.forEachProperty(function (propertyName) {
    if (Model.definition.properties[propertyName].readOnly) {
      readReadOnlyProperties[Model.modelName].push(propertyName);
    }
  });

  // store a list of importable properties (this contains markers for array properties and goes 2 levels deep)
  Model._importableProperties = getImportableProperties(Model);

  // store a list of importable top level properties (these are only the top level properties names, no array markers, no deep mapping)
  Model._importableTopLevelProperties = [];
  // build it from the list of importable properties by removing extra information
  Model._importableProperties.forEach(function (importablePropertyMap) {
    const property = importablePropertyMap.replace(/(?:\[]).*/, '');
    if (!Model._importableTopLevelProperties.includes(property)) {
      Model._importableTopLevelProperties.push(property);
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
