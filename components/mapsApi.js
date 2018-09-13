'use strict';

// requires
const app = require('../server/server');
const googleMapsService = require('@google/maps');

// external API client used to retrieve the geo locations
let client = null;

// flag that indicates the client has been initialized
// this is not enabled if the api key is not present in the config
let isEnabled = false;

/**
 * Find geo location for an address string
 * Using google's api
 * @param address
 * @param callback
 */
const getGeoLocation = function (address, callback) {
  return client.geocode({
    address: address
  }, (err, response) => {
    if (err) {
      app.logger.error(`Failed to retrieve geo location for address: ${address}. API response: ${err}`);
      return callback(err);
    }

    return callback(null, response.json.results.shift().geometry.location);
  });
};

/**
 * Initialize the external API client
 * @param apiKey
 */
const initClient = function (apiKey) {
  if (apiKey) {
    client = googleMapsService.createClient({ key: apiKey });
    isEnabled = true;
  }

  module.exports.isEnabled = isEnabled;
};

module.exports = {
  getGeoLocation: getGeoLocation,
  initClient: initClient
};
