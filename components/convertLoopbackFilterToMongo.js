'use strict';

const helpers = require('./helpers');
const moment = require('moment');

const convertProps = function (obj) {
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (prop === 'between') {
        if (Array.isArray(obj[prop])) {
          obj.$gte = obj[prop][0];
          obj.$lte = obj[prop][1];
          convertProps(obj.$gte);
          convertProps(obj.$lte);
        }
        delete obj[prop];
      } else if (prop === '$regex') {
        if (typeof obj[prop] === 'string' && /\/(.+)\/(.+)/.test(obj[prop])) {
          let matches = /\/(.+)\/(.+)/.exec(obj[prop]);
          obj[prop] = new RegExp(matches[1], matches[2]);
        }
      } else if (typeof obj[prop] == 'object' && obj[prop] !== null) {
        convertProps(obj[prop]);
      } else {
        // we're only looking for strings properties that have a date format to convert
        if (typeof obj[prop] === 'string' && helpers.isValidDate(obj[prop])) {
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
      .replace(/"eq"/g, '"$eq"')
      .replace(/"neq"/g, '"$ne"')
      .replace(/"ne"/g, '"$ne"')
  );
  // dates need to be date object
  convertProps(mongoFilter);
  return mongoFilter;
}

module.exports = convert;
