'use strict';

const app = require('../server');

/**
 * Rewrite authentication errors to add missing details (if any)
 * @param error
 * @param request
 * @param response
 * @param next
 */
function authenticationErrorHandler(error, request, response, next) {
  // rewrite authorization errors with missing permission errors when additional info is available
  if (
    error &&
    error.code === 'AUTHORIZATION_REQUIRED' &&
    request.authData &&
    Array.isArray(request.missingPermissions) &&
    request.missingPermissions.length
  ) {
    error = app.utils.apiError.getError('MISSING_REQUIRED_PERMISSION', {permissions: request.missingPermissions.join(', ')}, 403);
  }
  next(error);
}

module.exports = function () {
  return authenticationErrorHandler;
};
