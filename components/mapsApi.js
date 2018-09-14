'use strict';

// requires
const app = require('../server/server');
const googleMapsService = require('@google/maps');
const _ = require('lodash');

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
  try {
    client.geocode({
      address: address
    }, function (err, response) {
      if (err) {
        app.logger.error(`Failed to retrieve geo location for address: ${address}. API response: ${err}`);
        return callback(err);
      }

      return callback(null, _.get(response.json.results.shift(), 'geometry.location'));
    });
  } catch (err) {
    // when the API key is invalid, the library is throwing an error
    return callback(err);
  }
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
