'use strict';

const winston = require('winston');
const config = require('../server/config.json');

// winston uses 'warn' for 'warning'
if (config.logging.level === 'warning') {
  config.logging.level = 'warn';
}

winston.loggers.add('fileLogger', {
  file: {
    filename: `${__dirname}/../logs/application.log`,
    level: config.logging.level,
    maxsize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    tailable: true
  },
  console: {
    stderrLevels: ['error']
  }
});

let logger = winston.loggers.get('fileLogger');

// redirect console output to winston
console.log = logger.debug;
console.info = logger.info;
console.warn = logger.warn;
console.error = logger.error;

// initialize flag to prevent attaching the transport flush handler multiple times
let flushHandlerAdded = false;

/**
 * Stop process after logger flushes all messages
 * @param code
 */
logger.exitProcessAfterFlush = function(code) {
  // attach flush handler only once
  if(!flushHandlerAdded) {
    logger.transports.file.once('flush', function() {
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
    }
  });

  return transactionLogger;
};

module.exports = logger;
