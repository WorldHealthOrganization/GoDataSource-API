'use strict';

const localizationHelper = require('./localizationHelper');

const convertProps = function (obj) {
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (prop === 'between') {
        if (Array.isArray(obj[prop])) {
          obj.$gte = localizationHelper.checkIfDateAndConvert(obj[prop][0]);
          obj.$lte = localizationHelper.checkIfDateAndConvert(obj[prop][1]);
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
        obj[prop] = localizationHelper.checkIfDateAndConvert(obj[prop]);
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
