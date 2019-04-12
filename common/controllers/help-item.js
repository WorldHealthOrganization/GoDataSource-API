'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (HelpItem) {

  // expose only get list, other operations need to be done through their full path (via help category)
  app.utils.remote.disableRemoteMethods(HelpItem, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'prototype.__get__category',
    'prototype.__get__user',
    'count',
    'find'
  ]);

  /**
   * Retrieve help items
   * @param filter
   * @param callback
   */
  HelpItem.getHelpItems = (filter, callback) => {
    // attach default order for categories & help items
    if (
      !filter ||
      _.isEmpty(filter.order)
    ) {
      filter = filter || {};
      filter.order = [
        ...(app.models.helpCategory.defaultOrder || []).map((order) => `category.${order}`),
        ...app.models.helpItem.defaultOrder
      ];
    }

    // retrieve items
    app.models.helpItem
      .findAggregate(filter)
      .catch(callback)
      .then((data) => callback(null, data));
  };

  /**
   * Count help items
   * @param where
   * @param callback
   */
  HelpItem.countHelpItems = (where, callback) => {
    app.models.helpItem
      .findAggregate({ where: where }, true)
      .catch(callback)
      .then((data) => callback(null, data));
  };
};
