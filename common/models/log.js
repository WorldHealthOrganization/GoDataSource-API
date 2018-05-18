'use strict';

const app = require('../../server/server');

module.exports = function(Log) {
  // set flag to force using the controller
  Log.hasController = true;
};
