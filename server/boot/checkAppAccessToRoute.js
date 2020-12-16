'use strict';

/**
 * Check if a route is accessible for current deployment type (hub vs consolidation-server)
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addAfter('request-response-logger', 'check-app-access-to-route')
    .use(function (context, next) {
      next();
    });
};
