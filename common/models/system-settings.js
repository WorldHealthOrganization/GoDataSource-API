'use strict';

const app = require('../../server/server');

module.exports = function(SystemSettings) {
  app.utils.remote.disableRemoteMethods(SystemSettings, [
    'create',
    'findById',
    'deleteById',
    'prototype.patchAttributes',
    'count',
    'find'
  ]);

  /**
   * Retrieve System Settings
   * @param cb
   */
  SystemSettings.getSystemSettings = function (cb) {
    cb();
  };

  /**
   * Modify System Settings
   * @param data
   * @param cb
   */
  SystemSettings.updateSystemSettings = function (data, cb) {
    cb(null, data);
  };
};
