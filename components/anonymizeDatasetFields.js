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

    // treat phoneNumber as a special case; set the correct path under addresses
    if (!fields.includes('addresses') && fields.includes('phoneNumber')) {
      fields.splice(fields.indexOf('phoneNumber'), 1, 'addresses.phoneNumber');
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
        if (json[property] && typeof json[property] === 'object' && !(json[property] instanceof Date)) {
          // if the map contains sub-properties, anonymize recursively
          if (typeof fieldsMap[property] === 'object') {
            anonymize(json[property], fieldsMap[property]);
          } else if (
            // value is complex object
            !Array.isArray(json[property]) ||
            // first array value is complex object; considering all values are complex objects
            typeof json[property][0] === 'object'
          ) {
            // property value is an object/array of complex objects; anonymize all properties under the value
            // create an anonymization map for all the properties under the value
            const subPropertiesMap = (Array.isArray(json[property]) ? json[property] : [json[property]])
              .reduce((acc, item) => {
                if (!item) {
                  return acc;
                }

                Object.keys(item).forEach(key => {
                  acc[key] = true;
                });
                return acc;
              }, {});

            anonymize(json[property], subPropertiesMap);
          } else if (Array.isArray(json[property])) {
            // array of simple values; anonymize all
            json[property] = json[property].map(() => '***');
          } else {
            // other type; leaving it as is
          }
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
