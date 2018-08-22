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

  // register the special role resolver for client application permission
  // it should not be used for general purpose
  if (Role.hasOwnProperty('clientApplicationPermission')) {
    Role.registerResolver(Role.clientApplicationPermission, function (permission, context, done) {
      let buildError = app.utils.apiError.getError;
      let reqHeaders = context.remotingContext.req.headers;

      // retrieve authorization header and decode client credentials
      let clientId, clientSecret;
      if (reqHeaders.authorization) {
        let parts = reqHeaders.authorization.split(' ');
        if (parts.length === 2) {
          let [scheme, credentials] = parts;

          // check if authorization header contains the required format
          if (/^Basic$/i.test(scheme)) {
            let decodedCredentialsStr = Buffer.from(credentials, 'base64').toString();

            // check if credentials have the correct format
            [clientId, clientSecret] = decodedCredentialsStr.split(':');

            // cache client id on the context, it might be needed later in the handlers
            context.remotingContext.req.clientId = clientId;
            if (!clientId || !clientSecret) {
              return done(buildError('ACCESS_DENIED', { accessErrors: 'Invalid credentials' }, 403));
            }
          }
        } else {
          return done(buildError('ACCESS_DENIED', { accessErrors: 'Format is Authorization: Basic [token]' }, 403));
        }
      } else {
        return done(buildError('ACCESS_DENIED', { accessErrors: 'No Authorization header found' }, 403));
      }

      // flag that indicates whether the client is ok
      // initially is assumed that is not
      let hasAccess = false;

      // check the client credentials against any set in system settings
      app.models.systemSettings
        .findOne()
        .then((systemSettings) => {
          let clients = systemSettings.clientApplications;

          // try to find a match by client identifier
          let clientIndex = clients.findIndex((client) => {
            return client.credentials && client.credentials.clientId === clientId;
          });

          // if no client was found with the given id, or the client is inactive, stop with error
          if (clientIndex !== -1) {
            if (clients[clientIndex].active) {
              // check password
              hasAccess = clients[clientIndex].credentials.clientSecret === clientSecret;
            } else {
              return done(buildError('ACCESS_DENIED', { accessErrors: 'Client is not active' }, 403));
            }
          }

          if (hasAccess) {
            return done(null, hasAccess);
          }

          return done(buildError('ACCESS_DENIED', { accessErrors: 'Client credentials are wrong' }, 403));
        });
    });
  }
};
