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
      // there are 2 types for authentication in the API
      // 1. using accessToken
      // 2. using Authorization header
      // build context depending on the authentication type
      if (context.req && context.req.accessToken && context.req.accessToken.userId) {
        // access token authentication
        let accessToken = context.req.accessToken;

        return app.models.user
          .findById(accessToken.userId)
          .then(function (user) {

            // user not found, continue as if no token was sent
            if (!user) {
              return next();
            }

            context.req.authData = {
              user: user.toJSON(),
              // keeping also the user model instance as we might need to do some actions on it
              userInstance: user
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
                    // also store the list of permissions
                    context.req.authData.user.permissionsList = roles.reduce((permissions, role) => permissions.concat(role.permissionIds), []);
                    return done(null);
                  })
                  .catch(done);
              }
            ], (err) => next(err));
          })
          .catch(next);
      } else if (context.req.headers.authorization) {
        // Authorization header authentication
        let reqHeaders = context.req.headers;
        let parts = reqHeaders.authorization.split(' ');
        if (parts.length === 2) {
          let [scheme, credentials] = parts;

          // check if authorization header contains the required format
          if (/^Basic$/i.test(scheme)) {
            let decodedCredentialsStr = Buffer.from(credentials, 'base64').toString();

            // check if credentials have the correct format
            let [clientId, clientSecret] = decodedCredentialsStr.split(':');

            // get the client information from the system settings
            return app.models.clientApplication
              .findOne({
                where: {
                  'credentials.clientId': clientId
                }
              })
              .then((clientApplication) => {
                // if no client was found with the given id, or the client is inactive, stop with error
                if (!clientApplication) {
                  next();
                  return;
                }

                // cache client information on the context
                context.req.authData = {
                  // cache used credentials
                  credentials: {
                    clientId: clientId,
                    clientSecret: clientSecret
                  },
                  client: clientApplication.toJSON()
                };

                // finished
                next();
              })
              .catch(next);
          }

          if (/^Bearer$/i.test(scheme)) {
            // find and check the access token
            return app.models.accessToken.resolve(
              app.models.accessToken.getIdForRequest(context.req),
              (err, accessToken) => {
                if (err) {
                  return next(err);
                }

                // we need to attach access token to context for handling special loopback roles ($authenticated)
                context.req.accessToken = accessToken;

                // check if access token
                return app.models.user
                  .findById(accessToken.userId)
                  .then(function (user) {

                    // user not found, continue as if no token was sent
                    if (!user) {
                      return next();
                    }

                    context.req.authData = {
                      user: user.toJSON(),
                      // keeping also the user model instance as we might need to do some actions on it
                      userInstance: user
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
                            // also store the list of permissions
                            context.req.authData.user.permissionsList = roles.reduce((permissions, role) => permissions.concat(role.permissionIds), []);
                            return done(null);
                          })
                          .catch(done);
                      }
                    ], (err) => next(err));
                  })
                  .catch(next);
              });
          }
        }
      }

      // no authentication
      return next();
    });
};
