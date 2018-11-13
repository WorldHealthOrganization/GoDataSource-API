'use strict';

const app = require('../../server/server');

module.exports = function (HelpItem) {

  // disable bulk delete for related models
  app.utils.remote.disableRemoteMethods(HelpItem, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById'
  ]);
};
