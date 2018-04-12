'use strict';

const winston = require('winston');
const config = require('../server/config.json');

// winston uses 'warn' for 'warning'
if (config.logging.level === 'warning') {
  config.logging.level = 'warn';
}

// configure winston file transport
winston.add(winston.transports.File, {
  filename: `${__dirname}/../logs/application.log`,
  level: config.logging.level,
  maxsize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles
});

// redirect console output to winston
console.log = winston.debug;
console.info = winston.info;
console.warn = winston.warn;
console.error = winston.error;

/**
 * Get a contextual logger
 * @param transactionId
 * @return {{}}
 */
winston.getTransactionLogger = function (transactionId) {
  // contextual logger logs transaction id
  function log(level, message, metadata) {
    message = `[TransactionID: ${transactionId}] ${message}`;
    winston.log(level, message, metadata);
  }

  let logger = {};
  ['debug', 'info', 'warn', 'error'].forEach(function (logMethod) {
    logger[logMethod] = function (message, metadata) {
      log(logMethod, message, metadata);
    }
  });

  return logger;
};

module.exports = winston;
