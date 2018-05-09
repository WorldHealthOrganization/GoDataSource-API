'use strict';

const app = require('../../server/server');

module.exports = function (Location) {

  // set flag to not get controller
  Location.hasController = false;

  /**
   * Get sub-locations for a list of locations
   * @param parentLocations
   * @param allLocations
   * @param callback
   */
  Location.getSubLocations = function (parentLocations, allLocations, callback) {
    // all locations include parent locations
    parentLocations.forEach(function (location) {
      if (allLocations.indexOf(location) === -1) {
        allLocations.push(location);
      }
    });
    // find children location
    Location
      .find({
        where: {
          parentLocationId: {
            in: parentLocations
          }
        }
      })
      .then(function (locations) {
        // if children locations found
        if (locations.length) {
          // store them
          const foundLocations = [];
          locations.forEach(function (location) {
            // avoid loops
            if (allLocations.indexOf(location.id) === -1) {
              foundLocations.push(location.id);
            } else {
              app.logger.warn(`Detected loop in location hierarchy: location with id "${location.id}" is set as a child location for a location that is lower the hierarchy. Scanned locations ids: ${allLocations.join(', ')}`)
            }
          });
          // consolidate them in the locations list
          allLocations = allLocations.concat(foundLocations);
          // scan their children
          Location.getSubLocations(foundLocations, allLocations, callback);
        } else {
          // no more locations found, stop here
          callback(null, allLocations);
        }
      })
      .catch(callback);
  }
};
