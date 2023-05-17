'use strict';

const app = require('../../server/server');

module.exports = function (RestoreLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(RestoreLog, [
    'create',
    'deleteById',
    'prototype.patchAttributes'
  ]);
};
