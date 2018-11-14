'use strict';

const app = require('../../server/server');

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
};
