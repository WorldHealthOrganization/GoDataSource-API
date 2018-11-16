'use strict';

// requires
const querystring = require('querystring');
const app = require('../server/server');
const appConfig = require('../server/config.json');
const request = require('request');
const _ = require('lodash');

// generated token and expiration time
let token = null;

/**
 * Find geo location for an address string
 * Using google's api
 * @param address
 * @param callback
 */
const getGeoLocation = function (address, callback) {
  let getLocation = function () {
    return request.get(
      `${appConfig.mapsApi.geocodeServerUrl}/findAddressCandidates?SingleLine=${address}&forStorage=false&f=json&token=${token}`,
      (err, response, responseBody) => {
        if (err) {
          app.logger.warn(`Failed to generate geocode. ${err}`);
          return callback(err);
        }

        if (responseBody) {
          if (typeof responseBody === 'string') {
            try {
              responseBody = JSON.parse(responseBody);
            } catch (parseError) {
              app.logger.warn(`Failed to parse response. ${parseError}`);
              return callback(parseError);
            }
          }
          if (responseBody.error) {
            // invalid token
            if (responseBody.error.code === 498) {
              return generateAccessToken((err) => {
                if (err) {
                  return callback(err);
                }

                // token generation failed
                // nothing to do
                if (!token) {
                  return callback('Invalid external API credentials');
                }

                // retry the request
                return getLocation();
              });
            }

            // unexpected error, get out
            return callback();
          }

          // select the address candidate with highest score
          // return its coordinates
          let bestCandidate = _.maxBy(responseBody.candidates, (candidate) => candidate.score);

          return callback(null, bestCandidate ? bestCandidate.location : null);
        }
      }
    );
  };
  getLocation();
};

/**
 * Generate a new access token for using the external maps service
 * Information about the token are stored inside the module
 * Credentials are token from application config
 */
const generateAccessToken = function (callback) {
  callback = callback || function () {};

  let mapsOpts = appConfig.mapsApi;

  // build the query string payload
  let queryPart = querystring.stringify({
    client_id: mapsOpts.clientId,
    client_secret: mapsOpts.clientSecret,
    expiration: mapsOpts.tokenExpirationInMinutes,
    grant_type: 'client_credentials',
    f: 'json'
  });

  return request.get(
    `${mapsOpts.tokenUrl}?${queryPart}`,
    (err, response, responseBody) => {
      if (err) {
        app.logger.warn('Failed to generate access token for maps API');
        return callback(err);
      }

      if (responseBody) {
        if (typeof responseBody === 'string') {
          try {
            responseBody = JSON.parse(responseBody);
          } catch (parseError) {
            app.logger.warn(`Failed to parse response. ${parseError}`);
            return callback(parseError);
          }
        }
        if (responseBody.error) {
          app.logger.warn(`Failed to generate access token for maps API. ${responseBody}`);
          return callback();
        }
        token = responseBody.access_token;
      }

      return callback();
    }
  );
};

/**
 * Initialize the module by generating authenticating the client and storing information about the token
 */
const initClient = function () {
  generateAccessToken();
};

module.exports = {
  getGeoLocation: getGeoLocation,
  initClient: initClient
};
