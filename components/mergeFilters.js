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

  const _filter = {};

  if (filterExists('where')) {
    _filter.where = {
      and: [
        requestFilter.where || {},
        filter.where || {}
      ]
    };
  }

  if (filterExists('include')) {
    _filter.include = [];
    [filter, requestFilter].forEach(function (filterElement) {
      if (Array.isArray(filterElement.include) && filterElement.include.length) {
        _filter.include = _filter.include.concat(filterElement.include);
      } else if (typeof filterElement.include === 'string' || typeof filterElement.include === 'object') {
        _filter.include.push(filterElement.include)
      }
    });
  }

  ['fields', 'limit', 'order', 'skip', 'deleted'].forEach(function (filterName) {
    if (filterExists(filterName))
      _filter[filterName] = requestFilter[filterName] || filter[filterName];
  });

  // this should only be used internally
  if (filter.fn) {
    _filter.fn = filter.fn;
  }

  return _filter;
}

module.exports = merge;
