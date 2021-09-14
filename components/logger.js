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
 * @param {object} isMasterProcess - Flag specifying whether the logger is for the master process in a cluster configuration
 * @returns {winston.LoggerInstance}
 */
module.exports = function (fileLogger = false, isMasterProcess = false) {
  let logger;

  // init transports
  const transports = [];
  // init format
  let format;

  // check if we need to write logs in file
  if (fileLogger) {
    transports.push(
      new winston.transports.File({
        filename: `${__dirname}/../logs/application.log`,
        maxsize: config.logging.maxSize,
        maxFiles: config.logging.maxFiles,
        tailable: true
      }),
      new winston.transports.Console({
        stderrLevels: ['error']
      })
    );

    if (isMasterProcess) {
      // don't add additional formatting and stringify the message
      format = winston.format.printf(({message}) => {
        return message;
      });
    } else {
      format = winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      );
    }
  } else {
    transports.push(
      new winston.transports.Console({
        stderrLevels: ['error']
        // stringify: true
      })
    );

    format = winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    );
  }

  // create logger
  logger = winston.createLogger({
    level: config.logging.level,
    exitOnError: false,
    format,
    transports: transports
  });

  // handle winston errors
  logger.on('error', function (err) {
    process.stderr.write(`Logger error: ${err}`);
  });

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
      // flush logs to file
      logger.transports.file && logger.transports.file.on('finish', function () {
        process.exit(code);
      });

      flushHandlerAdded = true;

      this.end();
    } else {
      process.exit(code);
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
