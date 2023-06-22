'use strict';

const clusterConfig = require('./config.json').cluster || {};
const accessTokensCleanup = require('./../components/accessTokensCleanup');
const clusterHelpers = require('./../components/clusterHelpers');

/**
 * Start server
 * @param {Object} [logger] - Logger instance
 * @param {boolean} [startScheduler] - Flag specifying whether the process needs to start the scheduler
 */
const startServer = function (logger, startScheduler) {
  // load dependencies
  const ip = require('ip');
  const _ = require('lodash');
  const got = require('got');
  const config = require('./config');
  const path = require('path');
  const fs = require('fs-extra');
  const url = require('url');
  const v8 = require('v8');

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
      console.error(e && typeof e === 'object' && e.message ? e.message : e);
      /* eslint-enable no-console*/
      process.exit(1);
    }
  });

  // also catch unhandled rejections
  process.on('unhandledRejection', function (r) {
    throw r;
  });

  const beforeBoot = require('./beforeBoot/beforeBoot');
  logger = logger || require('../components/logger')();

  try {
    logger.debug('Process options', {
      nodeOptions: _.get(process, 'env.NODE_OPTIONS'),
      heapTotalAvailableSize: v8.getHeapStatistics().total_available_size / 1024 / 1024
    });
  } catch (err) {
    logger.debug('Failed to calculate heap statistics', err);
  }

  // before bootstraping loopback set missing required properties in datasources.json if needed
  // will throw error and process will stop on failure
  let mustUpdateConfigFile = false;
  const datasourcePath = path.resolve(__dirname + '/datasources.json');
  const datasourceContents = fs.readJsonSync(datasourcePath);
  if (_.get(datasourceContents, 'mongoDb.prohibitHiddenPropertiesInQuery') !== false) {
    _.set(datasourceContents, 'mongoDb.prohibitHiddenPropertiesInQuery', false);
    mustUpdateConfigFile = true;
  }
  if (_.get(datasourceContents, 'mongoDb.useNewUrlParser') !== false) {
    _.set(datasourceContents, 'mongoDb.useNewUrlParser', false);
    mustUpdateConfigFile = true;
  }
  if (_.get(datasourceContents, 'mongoDb.maxDepthOfData') === undefined) {
    _.set(datasourceContents, 'mongoDb.maxDepthOfData', 64);
    mustUpdateConfigFile = true;
  }
  if (mustUpdateConfigFile) {
    fs.writeJsonSync(datasourcePath, datasourceContents, {
      spaces: 2
    });
  }

  const loopback = require('loopback');
  const boot = require('loopback-boot');

  app = module.exports = loopback();
  app.logger = logger;

  // set flag for scheduler start
  app.startScheduler = startScheduler || false;

  app.start = function () {
    // start the web server
    const server = app.listen(function () {
      app.emit('started');

      if (config.enableConfigRewrite) {
        // try and figure out IP address
        let baseUrl = `http://${ip.address()}:${config.port}`;

        app.logger.debug(`Trying to find server address. Testing: ${baseUrl}`);

        // test if that IP address is actually the correct one by making a status request
        got(`${baseUrl}/status`, {
          responseType: 'json',
          resolveBodyOnly: true,
          // do not wait a lot of time for the server to respond
          timeout: 3000,
          retry: 0
        })
          .then(body => {
            // no error, but unexpected response
            if (!body || !body.started) {
              // log unexpected response
              app.logger.debug('Unexpected response from /status endpoint. Falling back to default address');
              // fallback to standard loopback address
              baseUrl = app.get('url').replace(/\/$/, '');
            }
          })
          .catch(error => {
            // log it
            app.logger.error(error);
            // fallback to standard loopback address
            baseUrl = app.get('url').replace(/\/$/, '');
          })
          .then(() => {
            app.logger.info('Web server listening at: %s', baseUrl);
            if (app.get('loopback-component-explorer')) {
              const explorerPath = app.get('loopback-component-explorer').mountPath;
              app.logger.info('Browse your REST API at %s%s', baseUrl, explorerPath);
            }

            // make sure we update the public data
            const urlData = url.parse(baseUrl);
            _.set(config, 'public.protocol', urlData.protocol.replace(':', ''));
            _.set(config, 'public.host', urlData.hostname);
            _.set(config, 'public.port', urlData.port ? urlData.port : '');

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

      clusterHelpers.handleMasterMessagesInWorker(app);
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

// check if cluster is enabled only if the server needs to start
// for package.json actions we will not use cluster
if (
  require.main === module &&
  clusterConfig.enabled === true
) {
  const cluster = require('cluster');
  const cpusNo = require('os').cpus().length;
  let processesNo = clusterConfig.processesNo === 'max' ?
    cpusNo :
    parseInt(clusterConfig.processesNo);
  (isNaN(processesNo) || processesNo > cpusNo) && (processesNo = cpusNo);

  if (cluster.isMaster) {
    // set cluster options
    cluster.schedulingPolicy = cluster.SCHED_RR;
    cluster.setupMaster({
      silent: true,
      windowsHide: true
    });

    // get logger; will get stdout and stderr from child processes so no need for formatting
    const logger = require('../components/logger')(true, true);
    logger.debug(`Master ${process.pid} is running. Forking ${processesNo} processes`);

    // remove access tokens if needed
    accessTokensCleanup(logger);

    // Fork workers.
    for (let i = 0; i < processesNo; i++) {
      // send param to the first child process to start scheduler; the other child processes will not touch the scheduler
      cluster.fork(i === 0 ? {startScheduler: true} : {});
    }

    // initialize cache for worker with scheduler
    let workerWithScheduler = 1;

    cluster.on('exit', (worker, code, signal) => {
      logger.debug(`Worker ${worker.process.pid} died. Code ${code}. Signal ${signal}`);

      if (workerWithScheduler === worker.id) {
        // worker with scheduler has died; we need to start a new worker with scheduler
        logger.debug('Worker that died was responsible for scheduler. Starting a new worker with scheduler');
        const newWorker = cluster.fork({startScheduler: true});
        workerWithScheduler = newWorker.id;
      } else {
        cluster.fork();
      }
    });

    // capture stdout and stderr from child processes and log messages
    cluster.on('online', (worker) => {
      logger.debug(`Worker ${worker.process.pid} started`);

      // initialize messages to be logged
      const message = {
        info: '',
        error: ''
      };

      /**
       * Log worker messages; They come in chunks
       * Concatenate related chunks to not have split messages in log
       * @param {Buffer} chunk - Chunk received from worker
       * @param {String} type - Type of message to be handled
       */
      const logWorkerMessage = function (chunk, type) {
        const chunkMessage = chunk.toString();
        const endOfLineIndex = chunkMessage.indexOf('\n');
        if (endOfLineIndex !== -1) {
          // we found an eol finish current message and log it
          message[type] += chunkMessage.substring(0, endOfLineIndex);
          logger.info(message[type]);

          // reinitialize message with remaining message in chunk
          const remainingMessage = chunkMessage.substring(endOfLineIndex + '\n'.length);
          message[type] = remainingMessage.length ? remainingMessage : '';
        } else {
          // no eol; chunk is part of a bigger message; will not log it now
          message[type] += chunkMessage;
        }
      };

      worker.process.stdout.on('data', chunk => {
        logWorkerMessage(chunk, 'info');
      });
      worker.process.stderr.on('data', chunk => {
        logWorkerMessage(chunk, 'error');
      });

      // broadcast messages received from a worker to other workers
      clusterHelpers.handleWorkerMessagesInMaster(worker, logger);
    });
  } else {
    // start server
    startServer(null, process.env.startScheduler === 'true');
  }
} else {
  // single process
  // get full logger
  const logger = require('../components/logger')(true);

  // remove access tokens if needed
  accessTokensCleanup(logger);

  // start server
  // start scheduler only when the actual application is starting; don't start on install scripts execution
  startServer(logger, require.main === module);
}
