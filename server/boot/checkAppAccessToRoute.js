'use strict';

/**
 * Check if a route is accessible for current deployment type (hub vs consolidation-server)
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addAfter('request-response-logger', 'check-app-access-to-route')
    .use(function (context, next) {
      // define allowed paths for each deployment type
      const access = {
        hub: '*',
        'consolidation-server': '*'
      };
      // get app type
      const appType = app.utils.helpers.getBuildInformation().type;
      // check if all routes are accessible for deployment type
      if (access[appType] === '*') {
        return next();
      }
      // get route
      const requestRoute = `${context.req.baseUrl}${context.req.route.path}`;
      // check if route is allowed
      if (access[appType].includes(requestRoute)) {
        return next();
      }
      // route is not allowed, stop with access error
      return next(app.utils.apiError.getError('ACCESS_DENIED_TO_ROUTE_FOR_APP', {
        app: appType,
        route: requestRoute
      }));
    });
};
