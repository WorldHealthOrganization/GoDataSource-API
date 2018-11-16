'use strict';

// requires
const appConfig = require('../config.json');

module.exports = function () {
  // do not generate access token if maps API is disabled
  if (appConfig.mapsApi.enabled) {
    require('../../components/mapsApi').initClient();
  }
};
