'use strict';
const Timer = require('../../components/Timer');

/**
 * Log outgoing response (if not already logged)
 * @param data
 * @param req
 * @param res
 */
function logResponse(data, req, res) {
  if (!req.loggedResponse) {
    req.loggedResponse = true;
    // log outgoing response
    req.logger.debug(`Sent Response: ${res.statusCode} ${req.method} ${req.originalUrl} Headers: ${JSON.stringify(res._headers)}${data ? ` Body: ${data.toString()}` : ''}. Response time: ${req.timer.getElapsedMilliseconds()} msec`);
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
      // log incoming request
      req.logger.debug(`Received Request: ${req.method} ${req.originalUrl} Headers: ${JSON.stringify(req.headers)} Body: ${JSON.stringify(req.body)}`);

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
