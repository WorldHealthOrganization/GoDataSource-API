'use strict';

let app;

// catch exceptions on startup
process.on('uncaughtException', function (e) {
  // check if app is initialized
  if (typeof app !== 'undefined') {
    app.logger.log('error', e);
    // stop process and log error
    app.logger.exitProcessAfterFlush(1);
  } else {
    console.error(e);
    process.exit(1);
  }
});


const beforeBoot = require('./beforeBoot/beforeBoot');
const logger = require('../components/logger');

const loopback = require('loopback');
const boot = require('loopback-boot');

app = module.exports = loopback();
app.logger = logger;

app.start = function () {
  // start the web server
  return app.listen(function () {
    app.emit('started');
    const baseUrl = app.get('url').replace(/\/$/, '');
    app.logger.info('Web server listening at: %s', baseUrl);
    if (app.get('loopback-component-explorer')) {
      const explorerPath = app.get('loopback-component-explorer').mountPath;
      app.logger.info('Browse your REST API at %s%s', baseUrl, explorerPath);
    }
  });
};

// run custom before boot initialisation
beforeBoot(app, function (error) {
  if (error) throw error;

  // Bootstrap the application, configure models, datasources and middleware.
  // Sub-apps like REST API are mounted via boot scripts.
  boot(app, __dirname, function (err) {
    if (err) throw err;

    // start the server if `$ node server.js`
    if (require.main === module)
      app.start();
  });

});
