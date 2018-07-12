'use strict';

const app = require('../../server/server');

module.exports = function (Sync) {
  /**
   * Retrieve a compressed snapshot of the database
   * Date filter is supported ({ fromDate: Date })
   * @param filter
   * @param done
   */
  Sync.getDatabaseSnapshot = function (filter, done) {
    filter = filter || {};
    filter.where = filter.where || {};

    Sync.exportDatabase(filter, [], (err, fileName) => {
      if (err) {
        return done(err);
      }
      return done(null, fileName);
    });
  };
};
