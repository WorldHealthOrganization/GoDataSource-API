'use strict';

const _ = require('lodash');

const errorMap = {
  MODEL_IN_USE: {
    messagePattern: 'Model "<%= model %>" id "<%= id %>" is in use.'
  },
  MODIFY_OWN_RECORD: {
    messagePattern: 'Model "<%= model %>" id "<%= id %>" is used by current logged in user. Cannot modify own record.'
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
