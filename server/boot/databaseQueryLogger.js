'use strict';

const uuid = require('uuid');
const Timer = require('../../components/Timer');

/**
 * Intercept database requests and log them for debugging purposes
 * @param app
 */
module.exports = function (app) {

  /**
   * Log query
   */
  app.dataSources.mongoDb.connector.observe('before execute', function (context, next) {
    context.req.queryId = uuid.v4();
    context.req.timer = new Timer();
    context.req.timer.start();
    app.logger.debug(`[QueryId: ${context.req.queryId}] Performing MongoDB request on model '${context.model}': ${context.req.command} ${JSON.stringify(context.req.params)}`);
    next();
  });

  /**
   * Log query completed (but not query result because it can be sensitive)
   */
  app.dataSources.mongoDb.connector.observe('after execute', function (context, next) {
    app.logger.debug(`[QueryId: ${context.req.queryId}] MongoDB request completed after ${context.req.timer.getElapsedMilliseconds()} msec`);
    next();
  });

};
