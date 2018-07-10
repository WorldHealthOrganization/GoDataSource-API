'use strict';

const uuid = require('uuid');

/**
 * Initialize transaction and contextual logger
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addBefore('auth', 'transaction-init')
    .use(function (context, next) {
      // get transaction-id from headers or generate one
      context.req.transactionId = context.req.headers['transaction-id'] || uuid.v4();
      context.req.logger = app.logger.getTransactionLogger(context.req.transactionId);
      next();
    });
};
