'use strict';

const app = require('../../server/server');

module.exports = function (ImportResult) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(ImportResult, [
    'create',
    'prototype.patchAttributes',
    'prototype.deleteById'
  ]);
};
