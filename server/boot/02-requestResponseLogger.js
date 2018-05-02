'use strict';

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
      // log incoming request
      req.logger.debug(`Received Request: ${req.method} ${req.originalUrl} Headers: ${JSON.stringify(req.headers)} Body: ${JSON.stringify(req.body)}`);
      const _write = res.write;
      res.write = function (data) {
        // log outgoing response
        req.logger.debug(`Sent Response: ${res.statusCode} ${req.method} ${req.originalUrl} Headers: ${JSON.stringify(res._headers)} Body: ${data.toString()}`);
        _write.apply(this, arguments);
      };
      next();
    });
};
