'use strict';

const helpers = require('./helpers');

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
      .replace(/"between"/g, '"$between"')
  );
  // dates need to be date object
  helpers.convertPropsToDate(mongoFilter);
  return mongoFilter;
}

module.exports = convert;
