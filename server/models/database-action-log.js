'use strict';

const app = require('../../server/server');

module.exports = function (DatabaseActionLog) {

  DatabaseActionLog.hasController = false;

  // after the application started (all models finished loading)
  app.on('started', function () {
    // fail any in progress sync/export actions;
    // the application was restarted/crashed and the sync/export will not continue
    // the sync/export action might have been partially successful in case of a restart/crash or totally successful and the sync/export log update action failed
    DatabaseActionLog
      .updateAll({
        status: 'LNG_SYNC_STATUS_IN_PROGRESS'
      }, {
        status: 'LNG_SYNC_STATUS_FAILED',
        error: 'Application was restarted before finalizing the sync/export action'
      })
      .then(function (info) {
        app.logger.debug(`Startup: ${info.count} sync/export actions that were 'in progress' after application restart. Changed status to failed`);
      })
      .catch(function (err) {
        app.logger.debug(`Startup: Update of 'in progress' sync/export actions status failed. Error: ${err}`);
      });
  });

  /**
   * Add additional error to the already set error
   * @param error
   */
  DatabaseActionLog.prototype.addError = function (error) {
    if(!this.error) {
      this.error = '';
    }

    this.error += `${error}; `;
  };
};
