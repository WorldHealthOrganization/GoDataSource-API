'use strict';

const app = require('../../server/server');

module.exports = function (User) {

  // get model helpers
  const helpers = User.helpers;

  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');
  // disable access to location
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'location');
  // disable access to role
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'role');
  // disable email verification, confirm endpoints
  app.utils.remote.disableRemoteMethods(User, ['prototype.verify', 'confirm']);

  /**
   * Do not allow deletion own user or the last user
   */
  User.beforeRemote('deleteById', function (context, modelInstance, next) {
    if (context.args.id === context.req.authData.user.id) {
      return next(app.utils.apiError.getError('DELETE_OWN_RECORD', {model: 'Role', id: context.args.id}, 403));
    }
    User.count()
      .then(function (userCount) {
        if (userCount < 2) {
          next(app.utils.apiError.getError('DELETE_LAST_USER', {}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * User cannot change its own role or location +
   * Validate user password
   */
  User.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.instance.id === context.req.authData.user.id) {
      delete context.args.data.roleId;
      delete context.args.data.locationId;
    }
    // validate password (if any)
    helpers.validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('create', function (context, modelInstance, next) {
    // validate password (if any)
    helpers.validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('changePassword', function (context, modelInstance, next) {
    // validate password (if any)
    helpers.validatePassword(context.args.newPassword, next);
  });
};
