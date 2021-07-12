'use strict';
const Timer = require('../../components/Timer');
const _ = require('lodash');
const config = require('../config');

/**
 * Log outgoing response (if not already logged)
 * @param data
 * @param req
 * @param res
 */
function logResponse(data, req, res) {
  if (!req.loggedResponse) {
    req.loggedResponse = true;

    // get stringified response body
    let responseBody = data ? ` Body: ${data.toString()}` : '';

    // check if response body should be trimmed
    const trimResponseBody = _.get(config, 'logging.requestResponse.trim', false);
    if (trimResponseBody) {
      // get maximum request body length
      const maxLength = _.get(config, 'logging.requestResponse.maxLength');
      // trim request body length to configured one
      if (responseBody.length > maxLength) {
        responseBody = responseBody.substring(0, maxLength) + '...(trimmed)';
      }
    }

    // log outgoing response
    req.logger.debug(`Sent Response: Response time: ${req.timer.getElapsedMilliseconds()} msec. ${res.statusCode} ${req.method} ${req.originalUrl} Headers: ${JSON.stringify(res._headers)}${responseBody}`);
  }
}

/**
 * Intercept API requests and responses and log them for debugging purposes
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addAfter('transaction-init', 'request-response-logger')
    .use(function (context, next) {
      const req = context.req;
      const res = context.res;
      req.timer = new Timer();
      req.timer.start();

      // get stringified request body
      let requestBody = JSON.stringify(req.body);

      // check if request body should be trimmed
      const trimResponseBody = _.get(config, 'logging.requestResponse.trim', false);
      if (trimResponseBody) {
        // get maximum request body length
        const maxLength = _.get(config, 'logging.requestResponse.maxLength');
        // trim request body length to configured one
        if (requestBody.length > maxLength) {
          requestBody = requestBody.substring(0, maxLength) + '...(trimmed)';
        }
      }

      // remove password
      try {
        requestBody = requestBody.replace(/('|")password('|")\s*:\s*('|")[^'"]*('|")/ig, '"password":"***"');
        requestBody = requestBody.replace(/('|")oldPassword('|")\s*:\s*('|")[^'"]*('|")/ig, '"oldPassword":"***"');
        requestBody = requestBody.replace(/('|")newPassword('|")\s*:\s*('|")[^'"]*('|")/ig, '"newPassword":"***"');
      } catch (e) {
        // NOTHING
      }

      // log incoming request
      req.logger.debug(`Received Request: ${req.method} ${req.originalUrl} Headers: ${JSON.stringify(req.headers)} Body: ${requestBody}`);

      // set the Transaction-Id header in the response
      res.setHeader('Transaction-Id', req.transactionId);
      // expose the Transaction-Id header to the client
      res.setHeader('Access-Control-Expose-Headers', 'Transaction-Id');

      // intercept responses, some use send
      const _send = res.send;
      res.send = function (data) {
        logResponse(data, req, res);
        _send.apply(this, arguments);
      };
      // some use end
      const _end = res.end;
      res.end = function (data) {
        logResponse(data, req, res);
        _end.apply(this, arguments);
      };
      next();
    });
};
