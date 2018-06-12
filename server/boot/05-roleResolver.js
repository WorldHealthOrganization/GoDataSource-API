'use strict';

module.exports = function (app) {

  const Role = app.models.role;

  /**
   * Store a missing permission in context for better authentication error handling
   * @param permission
   * @param context
   */
  function storeMissingPermissionInContext(permission, context) {
    if (!context.remotingContext.req.missingPermissions) {
      context.remotingContext.req.missingPermissions = [];
    }
    context.remotingContext.req.missingPermissions.push(permission);
  }

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
    if (!hasAccess) {
      storeMissingPermissionInContext(permission, context);
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
            if (!isOwner) {
              storeMissingPermissionInContext(`${permission} (not record owner)`, context);
            }
            callback(null, isOwner);
          })
          .catch(callback);

      } else if (recordIdMatch && context.remotingContext.req.method.toLowerCase() === 'post') {
        // create request, allow access
        callback(null, true);

      } else {
        storeMissingPermissionInContext(`${permission} (not record owner)`, context);
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
   * Verify if the user has permission to access an outbreak
   * @param permission
   * @param context
   * @param callback
   */
  function verifyOutbreakPermission(permission, context, callback) {
    // cache user's authentication data ref
    let userAuthData = context.remotingContext.req.authData.user;

    // if user has no outbreak ids restrictions, allow for all
    if (Array.isArray(userAuthData.outbreakIds) && !userAuthData.outbreakIds.length) {
      return callback(null, true);
    }

    // define regex for extracting outbreak id
    let outbreakIdRegExp = new RegExp(`^\\/api\\/outbreaks\\/([^\\/?]+)`);

    // extract id from request
    const outbreakIdMatch = context.remotingContext.req.originalUrl.match(outbreakIdRegExp);

    if (outbreakIdMatch && outbreakIdMatch[1]) {
      // outbreak id match found, check if user has access to the given outbreak
      if (userAuthData.outbreakIds.indexOf(outbreakIdMatch[1]) === -1) {
        storeMissingPermissionInContext(`${permission} (no access to the given outbreak)`, context);
        return callback(null, false);
      }
    }

    return callback(null, true);
  }

  /**
   * Roles are just groups of permissions, register role resolver for each permission
   */
  Object.keys(Role.availablePermissions).forEach(function (permission) {

    Role.registerResolver(permission, function (permission, context, callback) {
      let _callback = callback;

      /**
       * DEPRECATED feature
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
       */

      // after verifying the user has the permission, also verify ownership
      _callback = function (error, hasPermission) {
        if (error || !hasPermission) {
          return callback(error, hasPermission);
        }
        return verifyOutbreakPermission(permission, context, callback);
      };

      // verify if the user has the permission
      hasPermission(permission, context, _callback);
    });
  });
};
