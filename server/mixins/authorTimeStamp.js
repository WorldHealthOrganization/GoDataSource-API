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
 * @param options
 * @returns {*}
 */
function getLoggedInUserFromOptions(options) {
  const request = getRequestFromOptions(options);
  let loggedInUser;

  if (request && request.authData) {
    loggedInUser = request.authData.user;
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
   * @param context
   * @returns {{id: string}}
   */
  function getUserContextInformation(context) {
    let loggedInUser = getLoggedInUserFromOptions(context.options);
    return {
      id: loggedInUser ? loggedInUser.id : 'unavailable',
    }
  }

  Model.defineProperty('createdAt', {
    type: Date
  });

  Model.defineProperty('createdBy', {
    type: String
  });

  Model.defineProperty('updatedAt', {
    type: Date
  });

  Model.defineProperty('updatedBy', {
    type: String
  });

  Model.observe('before save', function (context, next) {
    let user = getUserContextInformation(context);
    if (context.instance) {
      if (context.isNewInstance) {
        context.instance.createdAt = new Date();
        context.instance.createdBy = user.id;
      }
      context.instance.updatedAt = new Date();
      context.instance.updatedBy = user.id
    } else {
      context.data.updatedAt = new Date();
      context.data.updatedBy = user.id;
    }
    return next();
  });
};
