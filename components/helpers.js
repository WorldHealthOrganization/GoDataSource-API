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

module.exports = {
  getUTCDate: getUTCDate
};
