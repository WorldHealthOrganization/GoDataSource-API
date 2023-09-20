'use strict';

// dependencies
const momentLib = require('moment');
const momentRange = require('moment-range');
const moment = momentRange.extendMoment(momentLib);

/**
 * Now (date + time)
 */
const now = function () {
  return moment();
};

/**
 * Today (date + start of day time)
 */
const today = function () {
  return moment().startOf('day');
};

/**
 * Convert a Date object into moment date and reset time to start of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the day of the week will not be changed
 */
const getDate = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).startOf('day') : moment.utc(moment().format('YYYY-MM-DD')).startOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment date and reset time to end of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the date will not be changed
 */
const getDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).endOf('day') : moment.utc(moment().format('YYYY-MM-DD')).endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Range
 */
const getRange = function (start, end) {
  return moment.range(start, end);
};

/**
 * Format a date string for display purpose
 * @param dateString
 * @returns {string}
 */
const getDateDisplayValue = function (dateString) {
  return dateString && moment(dateString).isValid() ? new Date(dateString).toISOString() : dateString;
};

/**
 * Format a date
 * If it fails, return empty string
 * @param value
 * @returns {string}
 */
const formatDate = function (value) {
  let result = '';
  if (value) {
    let tmpDate = moment(getDateDisplayValue(value));
    if (tmpDate.isValid()) {
      result = tmpDate.format('YYYY-MM-DD');
    }
  }
  return result;
};

/**
 * Convert to date..
 * @param date
 * @returns {moment.Moment}
 */
const convertToDate = function (date) {
  return moment(date).startOf('day');
};

/**
 * Check if a (string) date is valid (correct ISO format)
 * @param date
 * @return {boolean}
 */
const isValidDate = function (date) {
  return /^\d{4}-\d{2}-\d{2}[\sT]?(?:\d{2}:\d{2}:\d{2}(\.\d{3})?Z*)?$/.test(date);
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
        // we're only looking for strings properties that have a date format to convert
        if (typeof obj[prop] === 'string' && isValidDate(obj[prop])) {
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

/**
 * Converts Excel date in integer format into JS date
 * @param serial
 * @returns {string}
 */
const excelDateToJSDate = function (serial) {
  // constants
  const SECONDS_IN_DAY = 86400; // 24 * 60 * 60
  const DIFF_NUMBER_OF_DAYS = 25569; // (25567 + 2) - number of days between: Jan 1, 1900 and Jan 1, 1970, plus 2 ("excel leap year bug")

  // get date in utc
  const utcDays = Math.floor(serial - DIFF_NUMBER_OF_DAYS);
  const utcValue = utcDays * SECONDS_IN_DAY;
  const dateInfo = moment(utcValue * 1000);

  // calculate hours, minutes and seconds
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  let totalSeconds = Math.floor(SECONDS_IN_DAY * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;
  const hours = Math.floor(totalSeconds / (60 * 60));
  const minutes = Math.floor(totalSeconds / 60) % 60;

  // return full date
  return dateInfo
    .hour(hours)
    .minute(minutes)
    .seconds(seconds)
    .toISOString();
};

// exports
module.exports = {
  now,
  today,
  getDate,
  getDateEndOfDay,
  getRange,
  getDateDisplayValue,
  formatDate,
  convertToDate,
  isValidDate,
  convertPropsToDate,
  excelDateToJSDate
};
