'use strict';

// dependencies
const moment = require('moment');

/**
 * Convert a Date object into moment UTC date; reset day to the given day and reset time to start of the day
 * If no date is given, the current datetime is returned
 * @param date
 * @param dayOfWeek If not sent the date will not be changed
 */
const getUTCDate = function (date, dayOfWeek) {
  let momentDate = date ? moment(date).utc().startOf('day') : moment.utc().startOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment UTC date; reset day to the given day and reset time to end of the day
 * If no date is given, the current datetime is returned
 * @param date
 * @param dayOfWeek If not sent the date will not be changed
 */
const getUTCDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? moment(date).utc().endOf('day') : moment.utc().endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
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
  getUTCDateEndOfDay: getUTCDateEndOfDay,
  getAsciiString: getAsciiString
};
