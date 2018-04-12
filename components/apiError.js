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
  MISSING_REQUIRED_PERMISSION: {
    messagePattern: 'Logged in user does not have the required permission "<%= permission %>" to access this endpoint.'
  },
  DELETE_LAST_USER: {
    messagePattern: 'Cannot delete the last user of the system. The system must have at least one user.'
  }
};

module.exports = {
  /**
   * Get normalized API error
   * @param errorCode
   * @param info
   * @param statusCode
   * @return {{name: string, code: *, message: *, statusCode: *}}
   */
  getError: function (errorCode, info, statusCode) {
    return {
      name: 'Error',
      code: errorCode,
      message: _.template(errorMap[errorCode].messagePattern)(info),
      statusCode: statusCode
    }
  }
};
