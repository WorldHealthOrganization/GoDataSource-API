'use strict';

// dependencies
const momentLib = require('moment-timezone');
const momentRange = require('moment-range');
const moment = momentRange.extendMoment(momentLib);
const EpiWeek = require('epi-week');
const timezone = require('../server/config.json').timezone || 'UTC';

// default timezone
moment.tz.setDefault(timezone);

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
const getDateStartOfDay = function (date, dayOfWeek) {
  let momentDate = date ? toMoment(date).startOf('day') : today();
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment date and reset time to end of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the date will not be changed
 */
const getDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? toMoment(date).endOf('day') : moment().endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Get difference between dates in days
 * @param startDate
 * @param endDate
 */
const getDaysSince = function (startDate, endDate) {
  return getDateStartOfDay(endDate).diff(getDateStartOfDay(startDate), 'days');
};

/**
 * Range
 */
const getRange = function (start, end) {
  return moment.range(getDateStartOfDay(start), getDateStartOfDay(end));
};

/**
 * Format a date string for display purpose
 * @param dateString
 * @returns {string}
 */
const getDateDisplayValue = function (dateString) {
  return dateString && toMoment(dateString).isValid() ? toMoment(dateString).toISOString() : dateString;
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
    let tmpDate = toMoment(value);
    if (tmpDate.isValid()) {
      result = tmpDate.format('YYYY-MM-DD');
    }
  }
  return result;
};

/**
 * Convert to date
 * @returns {moment.Moment}
 */
const toMoment = function (
  date,
  format = undefined
) {
  return format ?
    moment(
      date,
      format
    ).tz(timezone) :
    moment(date).tz(timezone);
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
 * Calculate end of week for different type of weeks
 * @param date
 * @param weekType ISO, Sunday Starting, CDC (EPI WEEK)
 */
const calculateEndOfWeek = function (date, weekType) {
  weekType = weekType || 'iso';
  let result = null;
  switch (weekType) {
    case 'iso':
      result = date.clone().endOf('isoWeek');
      break;
    case 'sunday':
      result = date.clone().endOf('week');
      break;
    case 'epi':
      const epiWeek = EpiWeek(date.clone().toDate());
      result = date.clone().week(epiWeek.week).endOf('week');
      break;
  }
  return result;
};

/**
 * Split a date interval into chunks of specified length
 * @param start Interval start date
 * @param end Interval end date
 * @param chunkType String Length of each resulted chunk; Can be a (day, week, month)
 * @param weekType Type of week (epi, iso, sunday)
 */
const getDateChunks = function (start, end, chunkType, weekType = 'iso') {
  start = getDateStartOfDay(start);
  end = getDateEndOfDay(end);
  let result = [];
  switch (chunkType) {
    case 'day':
      let range = getRange(start, end);
      result = Array.from(range.by('day')).map(day => ({start: getDateStartOfDay(day), end: getDateEndOfDay(day)}));
      break;
    case 'week':
    case 'month':
      let date = start.clone();
      while (date.isBefore(end)) {
        if (!date.isSame(start)) {
          date.add(1, 'day');
        }
        let lastDate = chunkType === 'week' ? calculateEndOfWeek(date, weekType) : date.clone().endOf(chunkType);
        if (lastDate.isSameOrAfter(end)) {
          lastDate = end;
        }
        result.push({
          start: getDateStartOfDay(date.clone()),
          end: lastDate.clone()
        });
        date = lastDate;
      }
      break;
  }
  return result;
};

/**
 * Split a date interval into chunks of specified length
 * @param interval Array containing the margin dates of the interval
 * @param chunk String Length of each resulted chunk; Can be a daily/weekly/monthly
 * @param weekType Type of week (epi, iso, sunday)
 * @returns {{}} Map of chunks
 */
const getChunksForInterval = function (interval, chunk, weekType = 'iso') {
  // initialize map of chunk values
  let chunkMap = {
    day: 'day',
    week: 'week',
    month: 'month'
  };
  // set default chunk to 1 day
  chunk = chunk ? chunkMap[chunk] : chunkMap.day;

  // make sure we're always dealing with moment dates
  interval[0] = getDateStartOfDay(interval[0]);
  interval[1] = getDateEndOfDay(interval[1]);

  // get chunks
  let chunks = getDateChunks(interval[0], interval[1], chunk, weekType);

  // initialize result
  let result = {};

  // parse the chunks and create map with UTC dates
  chunks.forEach(chunk => {
    // create period identifier
    let identifier = chunk.start.toString() + ' - ' + chunk.end.toString();

    // store period entry in the map
    result[identifier] = {
      start: chunk.start,
      end: chunk.end
    };
  });

  return result;
};

/**
 * Get a period interval of period type for date
 * @param fullPeriodInterval period interval limits (max start date/max end date)
 * @param periodType enum: ['day', 'week', 'month']
 * @param date
 * @param weekType iso / sunday / epi (default: iso)
 * @return {['startDate', 'endDate']}
 */
const getPeriodIntervalForDate = function (
  fullPeriodInterval,
  periodType,
  date = undefined,
  weekType = 'iso'
) {
  // make sure dates are in interval limits
  if (
    fullPeriodInterval &&
    fullPeriodInterval.length > 1
  ) {
    date = getDateStartOfDay(date).isAfter(fullPeriodInterval[0]) ? date : getDateStartOfDay(fullPeriodInterval[0]);
    date = getDateStartOfDay(date).isBefore(fullPeriodInterval[1]) ? date : getDateEndOfDay(fullPeriodInterval[1]);
  }

  // get period in which the case needs to be included
  let startDay, endDay;
  switch (periodType) {
    case 'day':
      // get day interval for date
      startDay = getDateStartOfDay(date);
      endDay = getDateEndOfDay(date);
      break;
    case 'week':
      // get week interval for date
      weekType = weekType || 'iso';
      switch (weekType) {
        case 'iso':
          startDay = getDateStartOfDay(date).startOf('isoWeek');
          endDay = getDateEndOfDay(date).endOf('isoWeek');
          break;
        case 'sunday':
          startDay = getDateStartOfDay(date).startOf('week');
          endDay = getDateEndOfDay(date).endOf('week');
          break;
        case 'epi':
          date = getDateStartOfDay(date);
          const epiWeek = EpiWeek(date.clone().toDate());
          startDay = date.clone().week(epiWeek.week).startOf('week');
          endDay = date.clone().week(epiWeek.week).endOf('week');
          break;
      }

      break;
    case 'month':
      // get month period interval for date
      startDay = getDateStartOfDay(date).startOf('month');
      endDay = getDateEndOfDay(date).endOf('month');
      break;
  }

  // make sure dates are in interval limits
  if (
    fullPeriodInterval &&
    fullPeriodInterval.length > 1
  ) {
    startDay = startDay.isAfter(fullPeriodInterval[0]) ? startDay : getDateStartOfDay(fullPeriodInterval[0]);
    endDay = endDay.isBefore(fullPeriodInterval[1]) ? endDay : getDateEndOfDay(fullPeriodInterval[1]);
    endDay = endDay.isAfter(startDay) ? endDay : getDateEndOfDay(startDay);
  }

  // return period interval
  return [startDay.toString(), endDay.toString()];
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
          let convertedDate = toMoment(obj[prop]);
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

  // get date in utc - unix epoch
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

/**
 * Is instance of moment ?
 */
const isInstanceOfMoment = function (value) {
  // needs to be moment and NOT moment.Moment
  return value instanceof moment;
};

/**
 * Retrieve timezone
 */
const getTimezone = function () {
  return timezone;
};

// exports
module.exports = {
  getTimezone,
  isInstanceOfMoment,
  now,
  today,
  getDateStartOfDay,
  getDateEndOfDay,
  getDaysSince,
  getRange,
  getDateDisplayValue,
  formatDate,
  toMoment,
  isValidDate,
  getChunksForInterval,
  getPeriodIntervalForDate,
  convertPropsToDate,
  excelDateToJSDate
};
