'use strict';

const path = require('path');
const favicon = require('serve-favicon');

module.exports = function(app) {
  // serve favicon
  app.use('/', favicon(path.join(__dirname, '../..', 'favicon.ico')));
};
