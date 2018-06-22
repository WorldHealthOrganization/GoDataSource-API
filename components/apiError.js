'use strict';

const _ = require('lodash');
const errorMap = require('../server/config/apiErrors');

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
      details: info,
      toString: function () {
        return JSON.stringify(this, null, 2);
      }
    }
  }
};
