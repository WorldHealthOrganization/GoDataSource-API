'use strict';

const app = require('../../server/server');

module.exports = function (COT) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(COT, [
    'create',
    'prototype.patchAttributes'
  ]);
};
