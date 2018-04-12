'use strict';

module.exports = function (app) {

  const Role = app.models.role;

  /**
   * Verify if a user has the correct access permission
   * @param permission
   * @param context
   * @param callback
   */
  function hasPermission(permission, context, callback) {
    let hasAccess = false;
    if (
      context.remotingContext &&
      context.remotingContext.req &&
      context.remotingContext.req.authData &&
      context.remotingContext.req.authData.user &&
      context.remotingContext.req.authData.user.role &&
      Array.isArray(context.remotingContext.req.authData.user.role.permissions)
    ){
      hasAccess = context.remotingContext.req.authData.user.role.permissions.indexOf(permission) !== -1;
    }
    let accessError;
    if (!hasAccess) {
      accessError = app.utils.apiError.getError('MISSING_REQUIRED_PERMISSION', {permission: `${Role.availablePermissions[permission]} (${permission})`}, 403);
    }
    callback(accessError, hasAccess);
  }

  /**
   * Roles are just groups of permissions, register role resolver for each permission
   */
  Object.keys(Role.availablePermissions).forEach(function (permission) {
    Role.registerResolver(permission, function (permission, context, callback) {
      hasPermission(permission, context, callback);
    });
  });
};
