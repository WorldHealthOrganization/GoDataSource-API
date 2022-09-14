'use strict';

const moment = require('moment');

/**
 * Check if a (string) date is valid (correct ISO format)
 * - IMPORTANT: duplicate code to avoid circular dependency issue
 * @param date
 * @return {boolean}
 */
const isValidDate = function (date) {
  return /^\d{4}-\d{2}-\d{2}[\sT]?(?:\d{2}:\d{2}:\d{2}(\.\d{3})?Z*)?$/.test(date);
};

/**
 * Check if a property is in date format, if so, convert it to date object
 * @param prop
 * @returns {*}
 */
const checkIfDateAndConvert = function (prop) {
  // check if the property is in date format
  if (typeof prop === 'string' && isValidDate(prop)) {
    // try to convert the string value to date, if valid, replace the old value
    let convertedDate = moment(prop);
    if (convertedDate.isValid()) {
      prop = convertedDate.toDate();
    }
  }
  // return prop
  return prop;
};

const convertProps = function (obj) {
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (prop === 'between') {
        if (Array.isArray(obj[prop])) {
          obj.$gte = checkIfDateAndConvert(obj[prop][0]);
          obj.$lte = checkIfDateAndConvert(obj[prop][1]);
        }
        delete obj[prop];
      } else if (prop === '$regex') {
        if (typeof obj[prop] === 'string' && /^\/(.+)\/([gimusy]*)$/.test(obj[prop])) {
          let matches = /^\/(.+)\/([gimusy]*)$/.exec(obj[prop]);
          obj[prop] = new RegExp(matches[1], matches[2]);
        }
      } else if (typeof obj[prop] == 'object' && obj[prop] !== null) {
        convertProps(obj[prop]);
      } else {
        obj[prop] = checkIfDateAndConvert(obj[prop]);
      }
    }
  }
};


/**
 * Convert a loopback filter to a mongo filter
 * @param loopbackFilter
 * @return {any}
 */
function convert(loopbackFilter) {
  const mongoFilter = JSON.parse(
    JSON.stringify(loopbackFilter)
      .replace(/"and"/g, '"$and"')
      .replace(/"or"/g, '"$or"')
      .replace(/"inq"/g, '"$in"')
      .replace(/"nin"/g, '"$nin"')
      .replace(/"id"/g, '"_id"')
      .replace(/"lt"/g, '"$lt"')
      .replace(/"lte"/g, '"$lte"')
      .replace(/"gt"/g, '"$gt"')
      .replace(/"gte"/g, '"$gte"')
      .replace(/"regexp"/g, '"$regex"')
      .replace(/"like"/g, '"$regex"')
      .replace(/"options"/g, '"$options"')
      .replace(/"eq"/g, '"$eq"')
      .replace(/"neq"/g, '"$ne"')
      .replace(/"ne"/g, '"$ne"')
      .replace(/"exists"/g, '"$exists"')
      .replace(/"not"/g, '"$not"')
      .replace(/"elemMatch"/g, '"$elemMatch"')
      .replace(/"type":"null"/g, '"$type":"null"')
  );
  // dates need to be date object
  convertProps(mongoFilter);
  return mongoFilter;
}

module.exports = convert;
