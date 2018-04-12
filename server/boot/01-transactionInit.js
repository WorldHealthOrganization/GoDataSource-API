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
      context.req.transactionId = uuid.v4();
      context.req.logger = app.logger.getTransactionLogger(context.req.transactionId);
      next();
    });
};
