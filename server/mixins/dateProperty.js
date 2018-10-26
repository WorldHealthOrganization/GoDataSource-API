'use strict';


/**
 * Build a list of model date properties
 * @param Model
 */
module.exports = function (Model) {

  /**
   * Check if maximum nesting level was reached or the scan should go deeper
   * @param prefix
   * @return {boolean}
   */
  function shouldGoDeeper(prefix) {
    let levels = 0;
    if (typeof prefix === 'string') {
      // analyze prefix and count nesting level
      levels = (prefix.match(/\./g) || []).length;
    }
    // stop when nesting level goes beyond 3
    return levels < 3;
  }

  /**
   * Get Model date properties
   * @param Model
   * @param prefix This represents the parent property path
   * @return {Array}
   */
  function getDateProperties(Model, prefix) {
    // store a list of date properties
    let dateProperties = [];
    // go through all properties of the model
    Model.forEachProperty(function (propertyName) {
      // keep original property name
      let originalPropertyName = propertyName;
      // complex model type
      if (
        Model.definition.properties[originalPropertyName].type &&
        Model.definition.properties[originalPropertyName].type.definition
      ) {
        // check if the maximum nesting level was reached
        if (!shouldGoDeeper(prefix)) {
          return dateProperties;
        }
        // add prefix if needed
        if (prefix) {
          propertyName = `${prefix}.${propertyName}`;
        }
        // get next level of date properties and merge the results
        dateProperties = dateProperties.concat(getDateProperties(Model.definition.properties[originalPropertyName].type, propertyName));
      }
      // array of types
      if (Array.isArray(Model.definition.properties[originalPropertyName].type)) {
        // array of complex model types
        if (Model.definition.properties[originalPropertyName].type[0].definition) {
          // check if the maximum nesting level was reached
          if (!shouldGoDeeper(prefix)) {
            return dateProperties;
          }
          // add prefix if needed
          if (prefix) {
            propertyName = `${prefix}.${propertyName}`;
          }
          // get next level of importable properties and merge the results
          dateProperties = dateProperties.concat(getDateProperties(Model.definition.properties[originalPropertyName].type[0], `${propertyName}[]`));
          // array of date types
        } else if (Model.definition.properties[originalPropertyName].type[0].name === 'Date') {
          // update property name if needed
          if (prefix) {
            propertyName = `${prefix}.${propertyName}`;
          }
          // add it to the list of date properties
          dateProperties.push(`${propertyName}[]`);
        }
        // Date type
      } else if (
        Model.definition.properties[originalPropertyName].type &&
        Model.definition.properties[originalPropertyName].type.name === 'Date'
      ) {
        // add prefix if needed
        if (prefix) {
          propertyName = `${prefix}.${propertyName}`;
        }
        // add it to the list of date properties
        dateProperties.push(propertyName);
      }
    });
    // return the list of date properties
    return dateProperties;
  }

  // store a list of date properties
  Model._dateProperties = getDateProperties(Model);

  // store a list of date properties with parsed array props (nested mapping for arrays)
  // example: [ a[].b, a[].c, d ] => [ a: { b:b, c: c }, d:d ]
  Model._parsedDateProperties = (function mapProps(props) {
    let map = {};
    let seenArrayProps = [];

    props.forEach((prop) => {
      // split reference to check if it is an array
      let splitRef = prop.split('.');
      // make sure the array has not been processed before
      // doing this because on a single level you can have multiple references that point to the same array prop
      // example: [ a[].b, a[].c ]
      if (splitRef[0].indexOf('[]') >= 0 && seenArrayProps.indexOf(splitRef) === -1) {
        // find all occurrences of this array reference on the map
        let arrayNestedProps = props
          .filter((prop) => prop.indexOf(splitRef[0]) >= 0)
          .map((prop) => prop.slice(splitRef[0].length + 1));

        // mark array seen
        seenArrayProps.push(splitRef[0]);

        // convert all the references related to this array to a nested map
        // example: [ a[].b, a[].c ] => [ a: { b: b, c:c } ]
        map[splitRef[0].substring(0, splitRef[0].length - 2)] = mapProps(arrayNestedProps);
      } else {
        map[prop] = prop;
      }
    });

    return map;
  })(Model._dateProperties || []);
};
