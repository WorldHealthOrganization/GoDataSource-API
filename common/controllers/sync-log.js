'use strict';

const app = require('../../server/server');

module.exports = function (SyncLog) {
  // disable some actions
  app.utils.remote.disableRemoteMethods(SyncLog, [
    'create',
    'prototype.patchAttributes'
  ]);

  /**
   * Bulk delete sync log entries
   * @param where
   * @param options
   * @param callback
   */
  SyncLog.bulkDelete = function (where, options, callback) {
    // find sync log entries that need to be deleted (delete them one by one, to allow our hooks to be triggered correctly)
    SyncLog
      .find({
        where: where
      })
      .then(function (syncLogList) {
        // build a list of delete promises
        const deletePromises = [];
        // delete each sync log entry found
        syncLogList.forEach(function (syncLog) {
          deletePromises.push(syncLog.destroy(options));
        });
        return Promise.all(deletePromises);
      })
      .then(function (deletedRecords) {
        callback(null, deletedRecords.length);
      })
      .catch(callback);
  };
};
