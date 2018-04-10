'use strict';

/**
 * Attach remoting context to model options
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addBefore('invoke', 'attach-remoting-context')
    .use(function (context, next) {
      if (!context.args.options) {
        context.args.options = {};
      }
      context.args.options.remotingContext = context;
      next();
    });
};
