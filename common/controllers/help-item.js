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
    'prototype.__get__user'
  ]);

  /**
   * Attach before remote (GET help items ) hooks
   */
  HelpItem.beforeRemote('find', function (context, modelInstance, next) {
    // attach default order for categories
    if (
      !context.args.filter ||
      _.isEmpty(context.args.filter.order)
    ) {
      context.args.filter = context.args.filter || {};
      context.args.filter.order = app.models.helpItem.defaultOrder;
    }

    // continue
    next();
  });
};
