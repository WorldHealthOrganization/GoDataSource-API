'use strict';

const _ = require('lodash');

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
  let dataSetIsObject = false;
  if (typeof  replaceWith === 'function') {
    callback = replaceWith;
    useReplaceWith = false;
  }
  // do some basic validation
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

  let resultSet = [];
  try {
    if (!Array.isArray(dataSet)) {
      dataSet = [dataSet];
      dataSetIsObject = true;
    }
    // go through all entries
    dataSet.forEach(function (entry) {
      // do some basic validation of each entry
      if (typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('dataSet must be an array of objects or an object');
      }
      const _entry = _.cloneDeep(entry);
      // test & replace sensitive properties
      sensitiveProperties.forEach((sensitiveProperty) => {
        if(sensitiveProperty.indexOf('.') === -1) {
          _.set(_entry, sensitiveProperty, replaceMap[sensitiveProperty]);
        } else {
          let mainKey = sensitiveProperty.split('.')[0];
          let subKey = sensitiveProperty.split('.').splice(1).join('.');
          anonymize(_entry[mainKey], [subKey], '***', (err, result) => {
            _entry[mainKey] = result;
          });
        }
      });
      // update result set
      resultSet.push(_entry);
    });
    if (dataSetIsObject) {
      resultSet = resultSet[0];
    }
    callback(null, resultSet);
  } catch (error) {
    return callback(error);
  }
}

module.exports = {
  anonymize: anonymize
};
