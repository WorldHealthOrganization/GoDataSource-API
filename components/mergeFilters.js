'use strict';

/**
 * Merge a filter with request filter
 * @param filter
 * @param requestFilter
 * @return {*}
 */
function merge(filter, requestFilter = {}) {

  function filterExists(filterName) {
    return ((requestFilter[filterName] !== undefined) || (filter[filterName] !== undefined));
  }

  const _filter = filter;

  if (filterExists('where')) {
    _filter.where = {
      and: [
        requestFilter.where || {},
        filter.where || {}
      ]
    };
  }

  ['limit', 'order', 'skip'].forEach(function (filterName) {
    if (filterExists(filterName))
      _filter[filterName] = requestFilter[filterName] || filter[filterName];
  });

  return _filter;
}

module.exports = merge;
