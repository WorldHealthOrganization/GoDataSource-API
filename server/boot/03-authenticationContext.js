'use strict';

/**
 * Build authentication context
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addAfter('request-response-logger', 'authentication-context')
    .use(function (context, next) {
      let accessToken;

      if (context.req && context.req.accessToken) {
        accessToken = context.req.accessToken;
      }

      if (!accessToken || !accessToken.userId) {
        return next();
      }

      app.models.user
        .findById(accessToken.userId, {include: 'role'})
        .then(function (user) {
          context.req.authData = {
            user: user.toJSON()
          };
          next();
        })
        .catch(next);
    });
};
