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
      context.remotingContext.req.authData &&
      context.remotingContext.req.authData.user &&
      context.remotingContext.req.authData.user.role &&
      Array.isArray(context.remotingContext.req.authData.user.role.permissions)
    ) {
      hasAccess = context.remotingContext.req.authData.user.role.permissions.indexOf(permission) !== -1;
    }
    callback(null, hasAccess);
  }

  /**
   * Verify resource ownership
   * @param permission
   * @param context
   * @param callback
   */
  function verifyResourceOwnership(permission, context, callback) {

    /**
     * Check model ownership
     * @param model
     */
    function checkOwnership(model) {

      // define regex for extracting modelId
      let recordIdRegExp = new RegExp(`^\\/api\\/outbreaks\\/[^\\/]+\\/${model.modelName}s(?:\\/([^\\/?]+)|(?:$|\\?))`);

      // extract model if from request
      const recordIdMatch = context.remotingContext.req.originalUrl.match(recordIdRegExp);

      if (recordIdMatch && recordIdMatch[1]) {
        // recordId match found, check ownership
        let isOwner = false;
        // try to find the requested record
        model
          .findById(recordIdMatch[1])
          .then(function (record) {
            // if the record is found
            if (record) {
              // verify ownership
              isOwner = (record.createdBy === context.remotingContext.req.authData.user.id);
            }
            callback(null, isOwner);
          })
          .catch(callback);

      } else if (recordIdMatch && context.remotingContext.req.method.toLowerCase() === 'post'){
        // create request, allow access
        callback(null, true);

      } else {
        // recordId not found, deny access
        callback(null, false);
      }
    }

    // handle permissions that require ownership
    switch (permission) {
      case 'write_own_case':
        checkOwnership(app.models.case);
        break;
      case 'write_own_contact':
        checkOwnership(app.models.contact);
        break;
      default:
        callback(null, false);
        break;
    }
  }

  /**
   * Roles are just groups of permissions, register role resolver for each permission
   */
  Object.keys(Role.availablePermissions).forEach(function (permission) {

    Role.registerResolver(permission, function (permission, context, callback) {
      let _callback = callback;
      // if the permission requires ownership of the object
      if (permission.indexOf('_own_') !== -1) {
        // after verifying the user has the permission, also verify ownership
        _callback = function (error, hasPermission) {
          if (error || !hasPermission) {
            return callback(error, hasPermission);
          }
          return verifyResourceOwnership(permission, context, callback);
        }
      }
      // verify if the user has the permission
      hasPermission(permission, context, _callback);
    });
  });
};
