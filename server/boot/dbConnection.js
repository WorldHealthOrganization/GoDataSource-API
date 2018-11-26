'use strict';

/**
 * Test connection to Database. Loopback does it by default, when lazyConnect is not set, but we need lazyConnect as the
 * app is very big and until is (sync) loaded, it cannot get a reply back from mongo, which causes app to fail to load on
 * slow systems. In order to avoid the issue, we use lazyConnect and test DB connection once app started (no more sync loading)
 * @param app
 */
module.exports = function(app) {
  app.on('started', function() {
    // log initialization
    app.logger.info('Initializing database connection');
    // do a query on DB (initialize connection)
    app.models.systemSettings
      .findOne()
      .then(function () {
        // log init success
        app.logger.info('Database connection initialized');
      })
      .catch(function (error) {
        // stop application on error
        app.logger.error('Failed to initialize database connection', error);
        app.logger.exitProcessAfterFlush(1);
      });
  });
};
