'use strict';

const app = require('../server');

/**
 * Handle Internal Errors
 * @param error
 * @param request
 * @param response
 * @param next
 */
function internalError(error, request, response, next) {
  if (!error.statusCode) {
    // log original error
    if (request.logger) {
      request.logger.error(error, error.stack);
    } else {
      app.logger.error(error, error.stack);
    }
    // handle error
    next(app.utils.apiError.getError('INTERNAL_ERROR', {
      error: {
        code: error.code,
        message: error.message,
        name: error.name,
        toString: function () {
          return JSON.stringify(this);
        }
      }
    }));
  } else {
    next(error);
  }
}

module.exports = function () {
  return internalError;
};
