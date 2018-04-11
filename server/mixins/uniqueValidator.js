'use strict';

/**
 * Add support for 'unique' keyword in the list of properties.
 * @param Model
 */
module.exports = function (Model) {
  Model.forEachProperty(function (propertyName) {
    if (Model.definition.properties[propertyName].unique) {
      Model.validatesUniquenessOf(propertyName);
    }
  });
};
