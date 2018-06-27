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
   * Store a business logic access errors in context for better authentication error handling
   * @param accessError
   * @param context
   */
  function storeAccessErrorsInContext(accessError, context) {
    if (!context.remotingContext.req.accessErrors) {
      context.remotingContext.req.accessErrors = [];
    }

    if (Array.isArray(accessError)) {
      context.remotingContext.req.accessErrors = context.remotingContext.req.accessErrors.concat(accessError)
    } else {
      context.remotingContext.req.accessErrors.push(accessError);
    }
  }

  /**
   * Verify if a user has the correct access permission
   * @param permission
   * @param context
   * @param callback
   */
  function hasPermission(permission, context, callback) {
    // cache request authentication data reference
    let authData = context.remotingContext.req.authData;

    // flag that indicates whether the user has access to the given resource
    // initially is assumed that the user has no access
    let hasAccess = false;

    if (authData && authData.user && authData.user.permissionsList) {
      // check the permission against the user's permissionIds
      hasAccess = authData.user.permissionsList.indexOf(permission) !== -1;
    }

    if (!hasAccess) {
      storeMissingPermissionInContext(permission, context);
    }
    return callback(null, hasAccess);
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
   * Verify if the user does POST/PUT/DELETE actions on the active outbreak
   * @param permission
   * @param context
   * @param callback
   */
  function verifyOutbreakPermission(permission, context, callback) {
    // cache user's authentication data ref
    let userAuthData = context.remotingContext.req.authData.user;

    // initialize access error
    let accessErrors = [];

    // define regex for extracting outbreak id
    let outbreakIdRegExp = new RegExp(`^\\/api\\/outbreaks\\/([^\\/?]+)(\\/[^\\/?]+)?`);
    // extract id from request
    let outbreakIdMatch = context.remotingContext.req.originalUrl.match(outbreakIdRegExp);

    // check if the request is for outbreak or subresource
    if (outbreakIdMatch && outbreakIdMatch[1]) {
      // check if user has outbreak ids restrictions and check if he has access to the given outbreak
      if (userAuthData.outbreakIds &&
        Array.isArray(userAuthData.outbreakIds) &&
        userAuthData.outbreakIds.length &&
        userAuthData.outbreakIds.indexOf(outbreakIdMatch[1]) === -1
      ) {
        accessErrors.push(`access denied to the given outbreak; the outbreak is not set as one of the user's accessible outbreaks`);
      }

      // check if the user tries to do POST/PUT/DELETE on another outbreak related data than the active one (you can modify & delete inactive outbreaks)
      if (outbreakIdMatch[2] && context.remotingContext.req.method !== 'GET' && outbreakIdMatch[1] !== userAuthData.activeOutbreakId) {
        accessErrors.push(`access to POST/PUT/DELETE actions on outbreak related data is granted only for the active outbreak`);
      }
    }

    // check if there are access errors
    if (accessErrors.length) {
      storeAccessErrorsInContext(accessErrors, context);
      return callback(null, false);
    }

    return callback(null, true);
  }

  /**
   * Roles are just groups of permissions, register role resolver for each permission
   */
  Role.availablePermissionsKeys.forEach(function (permission) {

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
