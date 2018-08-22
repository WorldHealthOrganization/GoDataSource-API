'use strict';

/**
 * Construct a nested map of properties from a flat list. E.g. prop.subProp[].level3prop => {prop: {subProp: {level3prop: true}}}
 * @param fields
 */
const getDeepFieldsMap = function (fields) {
  // define fields map
  let fieldsMap = {};
  // if there are fields to be mapped
  if (Array.isArray(fields) && fields.length) {
    // go trough all of them
    fields.forEach(function (fieldPath) {
      // remove array markers (not needed)
      const sanitizedFieldPath = fieldPath.replace(/\[]/g, '');
      // get level separator
      const separatorIndex = sanitizedFieldPath.indexOf('.');
      // simple property type
      if (separatorIndex === -1) {
        fieldsMap[sanitizedFieldPath] = true;
      } else {
        // complex property type, get prop name and remaining part
        const propName = sanitizedFieldPath.substring(0, separatorIndex);
        const leftPath = sanitizedFieldPath.substring(separatorIndex + 1);
        // process complex property
        fieldsMap[propName] = getDeepFieldsMap([leftPath]);
      }
    });
  }
  return fieldsMap;
};

/**
 * Anonymize a list of fields in a json (object/list of objects)
 * @param json
 * @param fields
 */
const anonymize = function (json, fields) {
  // define a field map
  let fieldsMap;
  // if the fields are passed as a list
  if (Array.isArray(fields)) {
    // nothing to be anonymized
    if (!fields.length) {
      return;
    }
    // get nested field map
    fieldsMap = getDeepFieldsMap(fields);
  } else {
    // fields param is already a map
    fieldsMap = fields;
  }
  // if the passed data is an array
  if (Array.isArray(json)) {
    // anonymize each entry
    json.forEach(function (item) {
      anonymize(item, fields);
    });
  } else {
    // data is an object, go trough the properties
    Object.keys(json).forEach(function (property) {
      // check if the property needs to be anonymized
      if (fieldsMap[property]) {
        // if the property has sub-levels that need to be anonymized and the map contains sub-properties, anonymize recursively
        if (typeof fieldsMap[property] === 'object' && json[property] && typeof json[property] === 'object') {
          anonymize(json[property], fieldsMap[property]);
        } else if (fieldsMap[property] === true) {
          // map instructs to anonymize entire property
          json[property] = '***';
        }
      }
    });
  }
};

module.exports = {
  anonymize: anonymize
};
