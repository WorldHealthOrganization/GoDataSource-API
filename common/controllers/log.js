'use strict';

const app = require('../../server/server');

module.exports = function (Log) {

  /**
   * Add log messages
   * @param data
   * @param cb
   */
  Log.addLogs = function (data, cb) {
    let logMessages = data.messages;

    // write log messages
    logMessages.forEach(function (logMessage) {
      // get logging method
      let logMethod = logMessage.level === 'warning' ? 'warn' : logMessage.level;

      // log the message
      app.logger[logMethod](`[Client message]: ${logMessage.message}`);
    });

    cb(null, {count: logMessages.length});
  };
};
