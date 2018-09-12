'use strict';

const app = require('../../server/server');

module.exports = function (SyncLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(SyncLog, [
    'create',
    'prototype.patchAttributes'
  ]);
};
