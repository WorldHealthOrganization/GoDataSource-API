'use strict';

// requires
const app = require('../../server/server');
const mapsApi = require('../../components/mapsApi');
const appConfig = require('../../server/config.json');

module.exports = function (Maps) {

  app.utils.remote.disableRemoteMethods(Maps, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'count',
    'find'
  ]);

  /**
   * Find Geo-Location for an address
   * @param address
   * @param callback
   */
  Maps.findGeoLocationForAddress = function (address, callback) {
    // if maps api is not enabled, stop
    if (!appConfig.mapsApi.enabled) {
      return callback(app.utils.apiError.getError('MAPS_API_DISABLED'));
    }

    // build an address string
    const _address = ['addressLine1', 'addressLine2', 'city', 'country', 'postalCode']
      .filter((prop) => address[prop])
      .map((prop) => address[prop])
      .join();

    // find geo-location for address
    mapsApi.getGeoLocation(_address, function (err, location) {
      if (err) {
        callback(app.utils.apiError.getError('MAPS_GEO_LOCATION_ERROR', err));
      } else {
        callback(null, location);
      }
    });
  };
};
