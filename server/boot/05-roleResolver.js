'use strict';

const _ = require('lodash');

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
      context.remotingContext.req.accessErrors = context.remotingContext.req.accessErrors.concat(accessError);
    } else {
      context.remotingContext.req.accessErrors.push(accessError);
    }
  }

  /**
   * Store Authorization Required error in context
   * @param authorizationError
   * @param context
   */
  function storeAuthorizationErrorsInContext(authorizationError, context) {
    if (!context.remotingContext.req.authorizationErrors) {
      context.remotingContext.req.authorizationErrors = [];
    }
    context.remotingContext.req.authorizationErrors.push(authorizationError);
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
    let outbreakIdRegExp = new RegExp('^\\/api\\/outbreaks\\/([^\\/?]+)(\\/[^\\/?]+)?');
    // extract id from request
    let outbreakIdMatch = context.remotingContext.req.originalUrl.match(outbreakIdRegExp);

    // check if the request is for outbreak or subresource
    // this check assumes that in the path, 'outbreak/' is followed by it's id. However, there are a few instances where that is not the case
    if (outbreakIdMatch && outbreakIdMatch[1] && !['count', 'export', 'import-importable-file-using-map'].includes(outbreakIdMatch[1])) {
      // check if user has outbreak ids restrictions and check if he has access to the given outbreak
      if (userAuthData.outbreakIds &&
        Array.isArray(userAuthData.outbreakIds) &&
        userAuthData.outbreakIds.length &&
        userAuthData.outbreakIds.indexOf(outbreakIdMatch[1]) === -1
      ) {
        accessErrors.push('access denied to the given outbreak; the outbreak is not set as one of the user\'s accessible outbreaks');
      }

      // check if the user tries to do POST/PUT/DELETE on another outbreak related data than the active one (you can modify & delete inactive outbreaks)
      if (
        !_.get(context, 'remotingContext.method.http.ignoreActiveOutbreak') &&
        outbreakIdMatch[2] && outbreakIdMatch[2] !== '/restore' &&
        context.remotingContext.req.method !== 'GET' &&
        outbreakIdMatch[1] !== userAuthData.activeOutbreakId
      ) {
        accessErrors.push('access to POST/PUT/DELETE actions on outbreak related data is granted only for the active outbreak');
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
      // after verifying the user has the permission, also verify ownership
      const _callback = function (error, hasPermission) {
        if (error || !hasPermission) {
          return callback(error, hasPermission);
        }
        return verifyOutbreakPermission(permission, context, callback);
      };

      // verify if the user has the permission
      hasPermission(permission, context, _callback);
    });
  });

  // register the special role resolver for client application permission
  // it should not be used for general purpose
  if (Role.hasOwnProperty('clientApplicationPermission')) {
    Role.registerResolver(Role.clientApplicationPermission, function (permission, context, done) {
      let reqHeaders = context.remotingContext.req.headers;
      // client information and Authorization header information was already retrieved in when creating authentication context
      let clientInformation = _.get(context, 'remotingContext.req.authData.client', null);
      let clientCredentials = _.get(clientInformation, 'credentials', {});
      let usedCredentials = _.get(context, 'remotingContext.req.authData.credentials', null);

      // check authorization header and client credentials
      if (!reqHeaders.authorization) {
        app.logger.debug('No Authorization header found');
        return done(null, false);
      }
      let parts = reqHeaders.authorization.split(' ');
      if (parts.length !== 2) {
        app.logger.debug('Authorization header format is "Authorization: Basic [token]"');
        return done(null, false);
      }
      // check the used credentials against the ones found in system settings
      if (!clientInformation || !usedCredentials || clientCredentials.clientSecret !== usedCredentials.clientSecret) {
        storeAuthorizationErrorsInContext('Invalid credentials', context);
        return done(null, false);
      }
      // check if client is active
      if (!clientInformation.active) {
        storeAccessErrorsInContext('Client is not active', context);
        return done(null, false);
      }

      return done(null, true);
    });
  }
};
