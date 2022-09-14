'use strict';

const _ = require('lodash');

/**
 * Merge include filters
 * @param includeFilters
 * @return {Array}
 */
function mergeIncludeFilters(includeFilters) {
  const includeFilterMap = {};
  let _includeFilters = [];
  includeFilters.forEach(function (includeFilter) {
    // include is a simple string and it's the first occurrence of the include
    if (typeof includeFilter === 'string' && !includeFilterMap[includeFilter]) {
      // update include array & mark relation as simple include
      includeFilterMap[includeFilter] = {
        position: _includeFilters.push(includeFilter) - 1,
        complex: false
      };
      // include is a complex type and it's the first occurrence of the include
    } else if (includeFilter.relation && (!includeFilterMap[includeFilter.relation])) {
      // update include array & mark relation as complex include
      includeFilterMap[includeFilter.relation] = {
        position: _includeFilters.push(includeFilter) - 1,
        complex: true
      };
      // include is a complex type but the relation was already indexed as a simple type
    } else if (
      includeFilter.relation &&
      includeFilterMap[includeFilter.relation] &&
      !includeFilterMap[includeFilter.relation].complex
    ) {
      // update include filter with the complex one (the complex one takes priority) and mark it as complex
      _includeFilters[includeFilterMap[includeFilter.relation].position] = includeFilter;
      includeFilterMap[includeFilterMap.relation].complex = true;
      // include is a complex type, it has a scope defined, it was already indexed as a complex type, but without scope
    } else if (
      includeFilter.relation &&
      includeFilter.scope &&
      includeFilterMap[includeFilter.relation] &&
      includeFilterMap[includeFilter.relation].complex &&
      !_includeFilters[includeFilterMap[includeFilter.relation].position].scope
    ) {
      // copy the scope of the include
      _includeFilters[includeFilterMap[includeFilter.relation].position].scope = includeFilter.scope;
      // include is a complex type, it has a scope defined, it was already indexed as a complex type with a scope
    } else if (
      includeFilter.relation &&
      includeFilter.scope &&
      includeFilterMap[includeFilter.relation] &&
      includeFilterMap[includeFilter.relation].complex &&
      _includeFilters[includeFilterMap[includeFilter.relation].position].scope) {
      // merge the two scope filters
      _includeFilters[includeFilterMap[includeFilter.relation].position].scope = merge(includeFilters[includeFilterMap[includeFilter.relation].position].scope, includeFilter.scope);
    }
  });
  return _includeFilters;
}

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
    const isRequestFilterEmpty = _.isEmpty(requestFilter.where);
    const isFilterWhereEmpty = _.isEmpty(filter.where);
    if (
      !isRequestFilterEmpty &&
      !isFilterWhereEmpty
    ) {
      _filter.where = {
        and: [
          requestFilter.where,
          filter.where
        ]
      };
    } else if (!isRequestFilterEmpty) {
      _filter.where = requestFilter.where;
    } else if (!isFilterWhereEmpty) {
      _filter.where = filter.where;
    }
  }

  if (filterExists('include')) {
    _filter.include = [];
    [filter, requestFilter].forEach(function (filterElement) {
      if (Array.isArray(filterElement.include) && filterElement.include.length) {
        _filter.include = _filter.include.concat(filterElement.include);
      } else if (typeof filterElement.include === 'string' || typeof filterElement.include === 'object') {
        _filter.include.push(filterElement.include);
      }
    });
    _filter.include = mergeIncludeFilters(_filter.include);
  }

  ['fields', 'limit', 'order', 'skip', 'deleted', 'filterParent', '_deep'].forEach(function (filterName) {
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
