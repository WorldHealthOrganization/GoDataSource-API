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
    // There is only one entry in the system settings table; get it
    SystemSettings.findOne()
      .then(function (instance) {
        if(instance) {
          cb(null, instance);
        } else {
          // TODO use error module
          cb("error: not found");
        }
      })
      .catch(function (err) {
        // TODO use error module
        cb(err);
      });
  };

  /**
   * Modify System Settings
   * @param data
   * @param cb
   */
  SystemSettings.updateSystemSettings = function (data, cb) {
    // There is only one entry in the system settings table; get it and update it
    SystemSettings.findOne()
      .then(function (instance) {
        if(instance) {
          return instance.updateAttributes(data)
            .then(function(instance) {
              cb(null, instance);
            });
        } else {
          // TODO use error module
          throw "error: not found";
        }
      })
      .catch(cb);
  };
};
