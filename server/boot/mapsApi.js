'use strict';

// requires
const _ = require('lodash');

module.exports = function () {
  // retrieve app's config and try to find the google's api key
  const appConfig = require('../config.json');

  // try to get reference to the api key
  let apiKey = _.get(appConfig, 'googleApi.apiKey');

  // if API key is not set, the component will not boot
  require('../../components/mapsApi').initClient(apiKey);
};
