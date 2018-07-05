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
 * Convert filter date attributes from string to date
 * @param obj
 */
const convertPropsToDate = function (obj) {
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (typeof obj[prop] == 'object' && obj[prop] !== null) {
        convertPropsToDate(obj[prop]);
      } else {
        // we're only looking for strings properties to convert
        if (typeof obj[prop] === 'string') {
          // try to convert the string value to date, if valid, replace the old value
          let convertedDate = moment(obj[prop]);
          if (convertedDate.isValid()) {
            obj[prop] = convertedDate.toDate();
          }
        }
      }
    }
  }
};

module.exports = {
  getUTCDate: getUTCDate,
  convertPropsToDate: convertPropsToDate
};
