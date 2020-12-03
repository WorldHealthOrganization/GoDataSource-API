'use strict';

const clusterConfig = require('./config.json').cluster || {};
const accessTokenCleanup = require('./../components/accessTokensCleanup');

/**
 *
 */
const startServer = function () {

  // load dependencies
  const ip = require('ip');
  const _ = require('lodash');
  const request = require('request');
  const config = require('./config');
  const path = require('path');
  const fs = require('fs');
  const url = require('url');

  let app;

  // catch exceptions on startup
  process.on('uncaughtException', function (e) {
    // check if app is initialized
    if (typeof app !== 'undefined') {
      app.logger.log('error', e);
      // stop process and log error
      app.logger.exitProcessAfterFlush(1);
    } else {
      /* eslint-disable no-console */
      console.error(e);
      /* eslint-enable no-console*/
      process.exit(1);
    }
  });

  // also catch unhandled rejections
  process.on('unhandledRejection', function (r) {
    throw r;
  });

  const beforeBoot = require('./beforeBoot/beforeBoot');
  const logger = require('../components/logger')();

  const loopback = require('loopback');
  const boot = require('loopback-boot');

  app = module.exports = loopback();
  app.logger = logger;

  app.start = function () {
    // start the web server
    const server = app.listen(function () {
      app.emit('started');

      if (config.enableConfigRewrite) {
        // try and figure out IP address
        let baseUrl = `http://${ip.address()}:${config.port}`;

        app.logger.debug(`Trying to find server address. Testing: ${baseUrl}`);

        // test if that IP address is actually the correct one by making a status request
        request({
          uri: `${baseUrl}/status`,
          json: true,
          // do not wait a lot of time for the server to respond
          timeout: 3000
        }, function (error, response, body) {
          // if an error occurred
          if (error) {
            // log it
            app.logger.error(error);
            // fallback to standard loopback address
            baseUrl = app.get('url').replace(/\/$/, '');
          }
          // no error, but unexpected response
          if (!body || !body.started) {
            // log unexpected response
            app.logger.debug('Unexpected response from /status endpoint. Falling back to default address');
            // fallback to standard loopback address
            baseUrl = app.get('url').replace(/\/$/, '');
          }

          app.logger.info('Web server listening at: %s', baseUrl);
          if (app.get('loopback-component-explorer')) {
            const explorerPath = app.get('loopback-component-explorer').mountPath;
            app.logger.info('Browse your REST API at %s%s', baseUrl, explorerPath);
          }

          // make sure we update the public data
          const urlData = url.parse(baseUrl);
          _.set(config, 'public.protocol', urlData.protocol.replace(':', ''));
          _.set(config, 'public.host', urlData.hostname);
          _.set(config, 'public.port', urlData.port);

          // update configuration
          const configPath = path.resolve(__dirname + '/config.json');
          fs.writeFileSync(
            configPath,
            JSON.stringify(config, null, 2)
          );

          // config saved
          app.logger.info(
            'Config file ( %s ) public data updated to: %s',
            configPath,
            JSON.stringify(config.public)
          );
        });
      }
    });

    // remove default socket timeout and set it 12 hours
    // ref: https://nodejs.org/dist/latest-v12.x/docs/api/http.html#http_server_timeout
    server.timeout = 43200000;

    return server;
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
};

// check if cluster is enabled
if (clusterConfig.enabled === true) {
  const cluster = require('cluster');
  const cpusNo = require('os').cpus().length;
  let processesNo = clusterConfig.processesNo === 'max' ?
    cpusNo :
    parseInt(clusterConfig.processesNo);
  (isNaN(processesNo) || processesNo > cpusNo) && (processesNo = cpusNo);

  if (cluster.isMaster) {
    // get full logger
    const logger = require('../components/logger')(true);
    logger.debug(`Master ${process.pid} is running. Forking ${processesNo} processes`);

    // Fork workers.
    for (let i = 0; i < processesNo; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      logger.debug(`worker ${worker.process.pid} died`);
    });
  } else {
    console.debug(`Worker ${process.pid} started`);

    // start server
    startServer();
  }

} else {
  // single process
  // get full logger
  const logger = require('../components/logger')(true);

  // remove access tokens if needed
  accessTokenCleanup(logger);

  // start server
  startServer();
}
