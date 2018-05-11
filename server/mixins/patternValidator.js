'use strict';

/**
 * Add support for 'pattern' keyword in the list of properties.
 * @param Model
 */
module.exports = function (Model) {
  Model.forEachProperty(function (propertyName) {
    if (Model.definition.properties[propertyName].pattern) {
      Model.validatesFormatOf(propertyName, {
        with: new RegExp(Model.definition.properties[propertyName].pattern),
        message: `format is invalid. It should match /${Model.definition.properties[propertyName].pattern}/`
      });
    }
  });
};
