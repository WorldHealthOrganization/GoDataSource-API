'use strict';

const app = require('../server');

// keep a map of models to properties that should be removed
const propertiesMap = {};

app.on('started', function () {
  // go through the properties map
  Object.keys(propertiesMap).forEach(function (modelName) {
    // go through every property
    propertiesMap[modelName].forEach(function (propertyName) {
      // remove property from model definition
      delete app.models[modelName].definition.properties[propertyName];
      delete app.models[modelName].definition.rawProperties[propertyName];
      // remove property setters/getters from model prototype
      ['', 'get ', 'set ', '$', 'get $', 'set $'].forEach(function (prefix) {
        delete app.models[modelName].prototype[`${prefix}${propertyName}`];
      });
    });
  });
});


/**
 * Remove properties definitions from model, after startup
 * Useful for removing default setters/getters without removing the properties from doc/schemas
 * @param Model
 */
module.exports = function (Model) {

  if (Model.removePropertiesFromDefinion) {
    propertiesMap[Model.modelName] = Model.removePropertiesFromDefinion;
  }

};
