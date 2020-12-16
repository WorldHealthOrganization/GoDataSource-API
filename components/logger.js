'use strict';

const winston = require('winston');
const config = require('../server/config.json');
const _ = require('lodash');

// winston uses 'warn' for 'warning'
if (config.logging.level === 'warning') {
  config.logging.level = 'warn';
}

/**
 * Get logger
 * @param {boolean} fileLogger - Flag specifying if logs should be written to file
 * @param {object} fileLoggerOptions - Additional options for the file logger
 * @returns {winston.LoggerInstance}
 */
module.exports = function (fileLogger = false, fileLoggerOptions = {}) {
  let logger;
  // check if we need to write logs in file
  if (fileLogger) {
    winston.loggers.add('fileLogger', {
      file: Object.assign({
        filename: `${__dirname}/../logs/application.log`,
        level: config.logging.level,
        maxsize: config.logging.maxSize,
        maxFiles: config.logging.maxFiles,
        tailable: true
      }, fileLoggerOptions),
      console: Object.assign({
        stderrLevels: ['error'],
        level: config.logging.level
      }, fileLoggerOptions)
    });

    logger = winston.loggers.get('fileLogger');
  } else {
    winston.loggers.add('consoleLogger', {
      console: {
        stderrLevels: ['error'],
        level: config.logging.level,
        json: true,
        timestamp: true,
        stringify: true
      }
    });

    logger = winston.loggers.get('consoleLogger');
  }

  /* eslint-disable no-console */
  // redirect console output to winston
  console.log = logger.debug;
  console.info = logger.info;
  console.warn = logger.warn;
  console.error = logger.error;
  /* eslint-enable no-console */

  // initialize flag to prevent attaching the transport flush handler multiple times
  let flushHandlerAdded = false;

  /**
   * Stop process after logger flushes all messages
   * @param code
   */
  logger.exitProcessAfterFlush = function (code) {
    // attach flush handler only once
    if (!flushHandlerAdded) {
      logger.transports.file.once('flush', function () {
        process.exit(code);
      });

      flushHandlerAdded = true;
    }
  };

  /**
   * Get a contextual logger
   * @param transactionId
   * @return {{}}
   */
  logger.getTransactionLogger = function (transactionId) {
    // contextual logger logs transaction id
    function log(level, message, metadata) {
      message = `[TransactionID: ${transactionId}] ${message}`;
      logger.log(level, message, metadata);
    }

    let transactionLogger = {};
    ['debug', 'info', 'warn', 'error'].forEach(function (logMethod) {
      transactionLogger[logMethod] = function (message, metadata) {
        log(logMethod, message, metadata);
      };
    });

    return transactionLogger;
  };

  const logFn = logger.log;
  logger.log = function (level, message, ...rest) {
    // check if message should be trimmed
    const trimMessage = _.get(config, 'logging.trim', false);
    // for trimming, it must be a string
    if (typeof message == 'string' && trimMessage) {
      // get maximum request body length
      const maxLength = _.get(config, 'logging.maxLength');
      // trim request body length to configured one
      if (message.length > maxLength) {
        message = message.substring(0, maxLength) + '...(trimmed)';
      }
    }
    logFn.call(logger, level, message, ...rest);
  };

  return logger;
};
