'use strict';

const migrateDatabase = require('./../../server/install/scripts/migrateDatabase');

const worker = {
  /**
   * Migrate database
   * @returns {Promise<any>}
   */
  migrateDatabase: function () {
    return new Promise(function (resolve, reject) {
      migrateDatabase(err => err ? reject(err) : resolve());
    });
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args)
    .then(function (result) {
      process.send([null, result]);
    })
    .catch(function (error) {
      process.send([error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : error]);
    });
});

