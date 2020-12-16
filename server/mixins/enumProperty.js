'use strict';

/**
 * Add support for 'enum' keyword in the list of properties.
 * @param Model
 */
module.exports = function (Model) {
  Model.forEachProperty(function (propertyName) {
    if (Model.definition.properties[propertyName].enum) {
      Model.validatesInclusionOf(
        propertyName,
        {
          in: Model.definition.properties[propertyName].enum,
          message: ' value is not allowed. Allowed values: ' + Model.definition.properties[propertyName].enum.join(', '),
          // allow null values only if enum has 'null' entry
          allowNull: Model.definition.properties[propertyName].enum.indexOf(null) >= 0
        }
      );
    }
  });
};
