'use strict';

const cluster = require('cluster');
const _ = require('lodash');

// define list of handled messages
// !!!!!!!!!!!!!!!!!!
// Note: This list should be updated everytime a message needs to be distributes between cluster workers
// !!!!!!!!!!!!!!!!!!
const messageCodes = {
  clearLocationCache: 'clearLocationCache',
  clearUserCache: 'clearUserCache'
};

module.exports = {
  messageCodes,
  /**
   * Cluster worker send message functionality
   * @param {string} code - Message code
   * @param {object} logger - Logger instance
   */
  broadcastMessageToClusterWorkers: (code, logger) => {
    // don't do anything when we are not in cluster mode or process is not a worker
    if (!cluster.isWorker) {
      return;
    }

    let message;

    // handle received code
    // currently we just send the code but can be extended to handle codes differently
    switch (code) {
      case messageCodes.clearLocationCache:
      case messageCodes.clearUserCache:
        message = {
          code
        };
        break;
      default:
        logger.debug(`Worker ${process.pid} tried to send message with unhandled code '${code}' to other cluster workers`);
        break;
    }

    if (message) {
      logger.debug(`Worker ${process.pid} sent message '${JSON.stringify(message)}' to other cluster workers`);
      // send message
      process.send(message);
    }
  },
  /**
   * Handle worker messages in master
   * @param {Object} worker - Cluster worker instance
   * @param {Object} logger - Master logger
   */
  handleWorkerMessagesInMaster: (worker, logger) => {
    // broadcast messages received from a worker to other workers
    worker.on('message', (message => {
      logger.debug(`Master: received message ${JSON.stringify(message)} from worker ${worker.process.pid}. Broadcasting to other workers`);
      for (const id in cluster.workers) {
        const clusterWorker = cluster.workers[id];
        if (worker.process.pid !== clusterWorker.process.pid) {
          logger.debug(`Broadcasting to worker ${clusterWorker.process.pid}`);
          clusterWorker.send(message);
        }
      }
    }));
  },
  /**
   * Handle messages in a cluster worker
   * @param {Object} app - Loopback app
   */
  handleMasterMessagesInWorker: (app) => {
    // don't do anything when we are not in cluster mode or process is not a worker
    if (!cluster.isWorker) {
      return;
    }

    // handle received message
    process.on('message', (message) => {
      if (!(typeof message === 'object')) {
        app.logger.debug(`Process ${process.pid} received invalid message from master process: '${message}'`);
        return;
      }

      app.logger.debug(`Process ${process.pid} received message from master process: '${JSON.stringify(message)}'`);
      switch (message.code) {
        case messageCodes.clearLocationCache: {
          if (!_.get(app, 'models.location')) {
            // worker instance is not yet started so no cache is set; nothing to reset
            app.logger.debug(`Process ${process.pid} cannot reset location cache as location model is not yet initialized'`);
            break;
          }

          // reset location cache
          app.logger.debug(`Process ${process.pid} resetting location cache as requested by master process'`);
          app.models.location.cache.reset(true);
          break;
        }
        case messageCodes.clearUserCache:
          if (!_.get(app, 'models.user')) {
            // worker instance is not yet started so no cache is set; nothing to reset
            app.logger.debug(`Process ${process.pid} cannot reset location cache as user model is not yet initialized'`);
            break;
          }

          // reset user cache
          app.logger.debug(`Process ${process.pid} resetting user cache as requested by master process'`);
          app.models.user.cache.reset(true);
          break;
        default:
          return;
      }
    });
  }
};
