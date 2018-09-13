'use strict';

// requires
const app = require('../../server/server');
const request = require('request');
const _ = require('lodash');

module.exports = function (Maps) {

  /**
   * Retrieve Google API js script and serve it as reponse
   * @param callback
   */
  Maps.getAPIScript = function (callback) {
    // try to retrieve api key from configuration
    const appConfig = require('../../server/config.json');

    // try to get reference to the api key
    let apiKey = _.get(appConfig, 'googleApi.apiKey');

    // stop with not found
    if (!apiKey) {
      return callback(app.utils.apiError.getError('MAPS_API_KEY_INVALID'));
    }

    // if the script is already stored into memory just return it
    // otherwise, attach the key query param to the configured script path and store & return it
    if (Maps.scriptBuffer) {
      return callback(null, Maps.scriptBuffer);
    }

    request
      .get(`${Maps.scriptPath}${apiKey}`, (err, res, body) => {
        if (err) {
          return callback(err);
        }

        // store it into memory
        Maps.scriptBuffer = Buffer.from(body);

        return callback(null, Maps.scriptBuffer);
      });
  };
};
