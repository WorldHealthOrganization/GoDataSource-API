'use strict';

const app = require('../../server/server');

module.exports = function (Role) {

  // disable access to principals
  app.utils.remote.disableStandardRelationRemoteMethods(Role, 'principals');

  /**
   * Do not allow deletion of Roles that are in use
   */
  Role.beforeRemote('deleteById', function (context, modelInstance, next) {
    app.models.user
      .find({
        where: {
          roleId: context.args.id
        }
      })
      .then(function (users) {
        if (users.length) {
          next(app.utils.apiError.getError('MODEL_IN_USE', {model: 'Role', id: context.args.id}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * Do not allow modifying own role
   */
  Role.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.req.authData.user.roleIds.indexOf(context.instance.id) !== -1) {
      return next(app.utils.apiError.getError('MODIFY_OWN_RECORD', {model: 'Role', id: context.instance.id}, 403));
    }
    next();
  });

  /**
   * Get available permissions
   * @param callback
   */
  Role.getAvailablePermissions = function (callback) {
    callback(null, Role.availablePermissions);
  };
};
