'use strict';

// dependencies
const async = require('async');

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
        .findById(accessToken.userId)
        .then(function (user) {

          // user not found, continue as if no token was sent
          if (!user) {
            return next();
          }

          context.req.authData = {
            user: user.toJSON()
          };

          async.parallel([
            // add roles and their permissionIds on authentication context
            (done) => {
              app.models.role
                .find({
                  where: {
                    id: {
                      inq: user.roleIds
                    }
                  }
                })
                .then((roles) => {
                  context.req.authData.user.roles = roles;
                  return done(null);
                })
                .catch(done);
            }
          ], (err) => next(err));
        })
        .catch(next);
    });
};
