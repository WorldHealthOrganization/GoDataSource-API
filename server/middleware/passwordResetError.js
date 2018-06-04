'use strict';

/**
 * Handle password reset errors
 * @param error
 * @param request
 * @param response
 * @param next
 */
function passwordResetErrorHandler(error, request, response, next) {
  // if the error was caused by missing email
  if (
    error &&
    error.code === 'EMAIL_NOT_FOUND' &&
    request.method.toLowerCase() === 'post' &&
    request._parsedUrl.pathname === '/api/users/reset'
  ) {
    // log error
    request.logger.error(`Cannot reset password, email not found: ${JSON.stringify(error)}`);
    // fail silently (do not inform the client about missing user)
    error = null;
  }
  // if an error was found
  if (error) {
    // continue normal flow
    next(error);
  } else {
    // otherwise tell the client everything went fine
    response.send(204);
  }
}

module.exports = function () {
  return passwordResetErrorHandler;
};
