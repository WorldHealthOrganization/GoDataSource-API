'use strict';

// dependencies
const moment = require('moment');
const chunkDateRange = require('chunk-date-range');
const _ = require('lodash');

/**
 * Convert a Date object into moment UTC date and reset time to start of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the day of the week will not be changed
 */
const getUTCDate = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).startOf('day') : moment.utc().startOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment UTC date and reset time to end of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the date will not be changed
 */
const getUTCDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).endOf('day') : moment.utc().endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Remove non-ASCII chars from a string
 * @param string
 * @return {*}
 */
const getAsciiString = function (string) {
  return string.replace(/[^\x00-\x7F]/g, '');
};

/**
 * Convert a read to a buffer
 * @param stream
 * @param callback
 */
function streamToBuffer(stream, callback) {
  const chunks = [];
  stream.on('data', function (chunk) {
    chunks.push(chunk);
  });
  stream.on('end', function () {
    callback(null, Buffer.concat(chunks));
  });
}

/**
 * Split a date interval into chunks of specified length
 * @param interval Array containing the margin dates of the interval
 * @param chunk String Length of each resulted chunk; Can be a daily/weekly/monthly
 * @returns {{}} Map of chunks
 */
const getChunksForInterval = function (interval, chunk) {
  // initialize map for chunkDateRange chunk values
  let chunkMap = {
    day: 'day',
    week: 'week',
    month: 'month'
  };
  // set default chunk to 1 day
  chunk = chunk ? chunkMap[chunk] : chunkMap.day;

  // get chunks
  // Note chunkDateRange doesn't include the last day in the interval so we add a day
  let chunks = chunkDateRange(interval[0], interval[1], chunk);

  // initialize result
  let result = {};

  // parse the chunks and create map with UTC dates
  chunks.forEach(function (chunk, index) {
    // get the chunk margins and format to UTC
    let start = getUTCDate(chunk.start);
    // chunkDateRange uses for both start and end 00:00 hours;
    // we use 23:59 hours for end so we need to get the end of day for the previous day except for the last day in the interval since we already send it at 23:59 hours
    let end = getUTCDateEndOfDay(chunk.end);
    if (index !== chunks.length - 1) {
      end.add(-1, 'd')
    }

    // create period identifier
    let identifier = start.toString() + ' - ' + end.toString();

    // store period entry in the map
    result[identifier] = {
      start: start,
      end: end
    }
  });

  return result;
};

/**
 * Remap a list of items using a map. Optionally remap their values using a values map
 * @param list
 * @param fieldsMap
 * @param [valuesMap]
 * @return {Array}
 */
const remapProperties = function (list, fieldsMap, valuesMap) {
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
      _.set(result, fieldsMap[field], item[field]);
      // if a values map was provided
      if (valuesMap[field] && valuesMap[field][item[field]] !== undefined) {
        // remap the values
      _.set(result, fieldsMap[field], valuesMap[field][item[field]]);
      }
    });
    // add processed item to the final list
    results.push(result);
  });
  return results;
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
        // initialize date regexp
        let dateRegexp = /^\d{4}-\d{2}-\d{2}[\sT]?(?:\d{2}:\d{2}:\d{2}\.\d{3}Z*)?$/;

        // we're only looking for strings properties that have a date format to convert
        if (typeof obj[prop] === 'string' && dateRegexp.test(obj[prop])) {
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
 * Prepare a models fields for printing. So far, this means eliminating undefined values and formatting dates
 * @param model
 * @param dateFieldsList
 * @returns {Object}
 */
const prepareFieldsForPrint = function (model, dateFieldsList) {

  // Format date fields
  dateFieldsList.forEach((field) => {
    if(field.indexOf('.') === -1) {
      if (_.get(model, field)) {
        _.set(model, field, new Date(_.get(model, field)).toISOString());
      }
    } else {
      // separate the string into the name of the array type property and the name the field that needs to be translated
      let mainKey = field.split('.')[0];
      let subKey = field.split('.').slice(1).join('.');
      // translate the field from each element of the array type property
      model[mainKey].forEach((element) => {
        prepareFieldsForPrint(element, [subKey]);
      })
    }
  });

  // Sanitize undefined fields
  return _.mapValues(model, (value, key) => {
    if (value === undefined) {
      return ' ';
    } else {
      return value;
    }
  })
};

module.exports = {
  getUTCDate: getUTCDate,
  streamToBuffer: streamToBuffer,
  remapProperties: remapProperties,
  getUTCDateEndOfDay: getUTCDateEndOfDay,
  getAsciiString: getAsciiString,
  getChunksForInterval: getChunksForInterval,
  convertPropsToDate: convertPropsToDate,
  prepareFieldsForPrint: prepareFieldsForPrint
};
