'use strict';

/**
 * Add support for 'unique' keyword in the list of properties.
 * @param Model
 */
module.exports = function (Model) {
  Model.forEachProperty(function (propertyName) {
    // add unique validator
    if (Model.definition.properties[propertyName].unique) {
      // case sensitive or not ?
      const props = {};
      if (Model.definition.properties[propertyName].ignoreCase !== undefined) {
        props.ignoreCase = Model.definition.properties[propertyName].ignoreCase;
      }

      // validate
      Model.validatesUniquenessOf(
        propertyName,
        props
      );
    }
  });
};
