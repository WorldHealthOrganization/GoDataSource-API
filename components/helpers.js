'use strict';

// dependencies
const moment = require('moment');

/**
 * Convert a Date object into moment UTC date and reset time to start of the day
 * If no date is given, the current datetime is returned
 * @param date
 */
const getUTCDate = function (date) {
  return date ? moment(date).utc().startOf('day') : moment.utc().startOf('day');
};

/**
 * Remove non-ASCII chars from a string
 * @param string
 * @return {*}
 */
const getAsciiString = function(string) {
  return string.replace(/[^\x00-\x7F]/g, '');
};

/**
 * Remap a list of items using a map
 * @param list
 * @param fieldsMap
 * @return {Array}
 */
const remapProperties = function (list, fieldsMap){
  // store final result
  let results = [];
  // get a list of source fields
  let fields = Object.keys(fieldsMap);
  // go through the list of items
  list.forEach(function (item) {
    // build each individual item
    let result = {};
    // go trough the list of fields
    fields.forEach(function (field) {
      // remap property
      result[fieldsMap[field]] = item[field];
    });
    // add processed item to the final list
    results.push(result);
  });
  return results;
};

module.exports = {
  getUTCDate: getUTCDate,
  getAsciiString: getAsciiString,
  remapProperties: remapProperties
};
