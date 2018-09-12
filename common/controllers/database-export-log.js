'use strict';

const app = require('../../server/server');

module.exports = function (DatabaseExportLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(DatabaseExportLog, [
    'create',
    'prototype.patchAttributes'
  ]);
};
