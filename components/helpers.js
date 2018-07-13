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

module.exports = {
  getUTCDate: getUTCDate,
  getAsciiString: getAsciiString
};
