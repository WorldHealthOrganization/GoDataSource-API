'use strict';

/**
 * Extract request form options (if available)
 * @param options
 * @returns {*}
 */
function getRequestFromOptions(options) {
  let request;

  if (options.remotingContext && options.remotingContext.req) {
    request = options.remotingContext.req;
  }

  return request;
}

/**
 * Get logged in user from options (if available)
 * Might be a client instance for sync requests
 * @param options
 * @returns {*}
 */
function getLoggedInUserFromOptions(options) {
  const request = getRequestFromOptions(options);
  let loggedInUser;

  if (request && request.authData) {
    if (request.authData.user) {
      loggedInUser = request.authData.user;
    } else if (request.authData.client) {
      loggedInUser = request.authData.client;
    }
  }

  return loggedInUser;
}

/**
 * Add createdAt, createdBy, updatedAt, updatedBy properties (and keep them up to date)
 * @param Model
 */
module.exports = function (Model) {

  /**
   * Extract user information from request
   * Might be a client for sync requests
   * @param context
   * @returns {{id: string}}
   */
  function getUserContextInformation(context) {
    let loggedInUser = getLoggedInUserFromOptions(context.options);
    // get the ID; initialize as unavailable
    let id = 'unavailable';
    // check for client instance or user
    if (loggedInUser) {
      if (loggedInUser.credentials) {
        id = `Sync. Client Id: ${loggedInUser.credentials.clientId}`;
      } else if (loggedInUser.id) {
        id = loggedInUser.id;
      }
    }

    return {
      id: id
    };
  }

  Model.defineProperty('createdAt', {
    type: Date,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty('createdBy', {
    type: String,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty('updatedAt', {
    type: Date,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty('updatedBy', {
    type: String,
    readOnly: true,
    safeForImport: true
  });

  Model.observe('before save', function (context, next) {
    // normalize context options
    context.options = context.options || {};
    // get user information
    let user = getUserContextInformation(context);
    if (context.instance) {
      if (context.isNewInstance) {
        // update createdAt property if it's not a init, sync or the property is missing from the instance
        if (!context.instance.createdAt || (!context.options._init && !context.options._sync)) {
          context.instance.createdAt = new Date();
        }
        context.instance.createdBy = user.id;
      }
      // update updatedAt property if it's not a init, sync or the property is missing from the instance
      if (!context.instance.updatedAt || (!context.options._init && !context.options._sync)) {
        context.instance.updatedAt = new Date();
      }
      context.instance.updatedBy = user.id;
    } else {
      // update updatedAt property if it's not a init, sync or the property is missing from the instance
      if (!context.data.updatedAt || (!context.options._init && !context.options._sync)) {
        context.data.updatedAt = new Date();
      }
      context.data.updatedBy = user.id;
    }
    return next();
  });
};
