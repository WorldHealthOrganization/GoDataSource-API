'use strict';

const _ = require('lodash');

const errorMap = {
  MODEL_IN_USE: {
    messagePattern: 'Model "<%= model %>" id "<%= id %>" is in use.'
  },
  MODIFY_OWN_RECORD: {
    messagePattern: 'Model "<%= model %>" id "<%= id %>" is used by current logged in user. Cannot modify own record.'
  },
  DELETE_OWN_RECORD: {
    messagePattern: 'Model "<%= model %>" id "<%= id %>" is used by current logged in user. Cannot delete own record.'
  },
  DELETE_LAST_USER: {
    messagePattern: 'Cannot delete the last user of the system. The system must have at least one user.'
  },
  DELETE_ACTIVE_OUTBREAK: {
    messagePattern: 'The outbreak (id: "<%= id %>") is active. Cannot delete an active outbreak.'
  },
  ONE_ACTIVE_OUTBREAK: {
    messagePattern: 'There is already an active outbreak (id: "<%= id %>") in the system.'
  },
  FUNCTIONALITY_NOT_IMPLEMENTED: {
    messagePattern: 'The requested functionality is not implemented.'
  },
  MODEL_NOT_FOUND: {
    defaultStatusCode: 404,
    messagePattern: 'Unknown "<%= model %>" id "<%= id %>"'
  },
  INTERNAL_ERROR: {
    defaultStatusCode: 500,
    messagePattern: 'Internal error: "<%= error %>"'
  }
};

module.exports = {
  /**
   * Get normalized API error
   * @param errorCode
   * @param info
   * @param [statusCode]
   * @return {{name: string, code: *, message: *, statusCode: *}}
   */
  getError: function (errorCode, info, statusCode) {
    statusCode = statusCode || errorMap[errorCode].defaultStatusCode;

    return {
      name: 'Error',
      code: errorCode,
      message: _.template(errorMap[errorCode].messagePattern)(info),
      statusCode: statusCode,
      toString: function () {
        return JSON.stringify(this, null, 2);
      }
    }
  }
};
