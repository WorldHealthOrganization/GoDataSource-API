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

module.exports = winston;
