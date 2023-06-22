'use strict';

const app = require('../../server/server');

module.exports = function (ImportLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(ImportLog, [
    'create',
    'deleteById',
    'prototype.patchAttributes'
  ]);
};
