'use strict';

const app = require('../../server/server');

module.exports = function (Sync) {
  // disable Loopback's default remote methods
  app.utils.remote.disableRemoteMethods(Sync, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'count',
    'find'
  ]);
};
