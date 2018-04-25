'use strict';

/**
 * Anonymize fields of a dataSet
 * @param dataSet Array of (object) items
 * @param fields List of properties. Each property can either be a (string) property name or an object {name: '<propertyName>', replaceValue: '<replaceValue>'}
 * @param [replaceWith] Global replacer
 * @param callback
 * @return {*}
 */
function anonymize(dataSet, fields, replaceWith, callback) {
  fields = fields || [];
  // replaceWith argument is optional
  let useReplaceWith = true;
  if (typeof  replaceWith === 'function') {
    callback = replaceWith;
    useReplaceWith = false;
  }
  // do some basic validation
  if (!Array.isArray(dataSet)) {
    return callback(new Error('dataSet must be an array of objects'));
  }
  if (!Array.isArray(fields)) {
    return callback(new Error('fields must be an array of properties'));
  }

  const replaceMap = {};
  const NO_REPLACE = '__NO_REPLACE__';

  // set up replace values for each property (if any)
  fields.forEach(function (sensitiveField) {
    if (typeof sensitiveField === 'string') {
      if (useReplaceWith) {
        replaceMap[sensitiveField] = replaceWith;
      } else {
        replaceMap[sensitiveField] = NO_REPLACE;
      }
    } else if (typeof sensitiveField === 'object') {
      replaceMap[sensitiveField.name] = sensitiveField.replaceValue;
    }
  });

  // store a (flat) list of sensitive property names
  const sensitiveProperties = Object.keys(replaceMap);

  const resultSet = [];
  try {
    // go through all entries
    dataSet.forEach(function (entry) {
      // do some basic validation of each entry
      if (typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('dataSet must be an array of objects');
      }
      const _entry = {};
      // test & replace sensitive properties
      Object.keys(entry).forEach(function (propertyName) {
        if (sensitiveProperties.indexOf(propertyName) === -1) {
          // non sensitive properties are copied
          _entry[propertyName] = entry[propertyName];
        } else if (replaceMap[propertyName] !== NO_REPLACE){
          // properties that need to be replaced are replaced
          _entry[propertyName] = replaceMap[propertyName];
        }
        // others are skipped
      });
      // update result set
      resultSet.push(_entry);
    });
    callback(null, resultSet);

  } catch (error) {
    return callback(error);
  }
}

module.exports = {
  anonymize: anonymize
};
