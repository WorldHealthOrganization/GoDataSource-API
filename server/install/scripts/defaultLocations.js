'use strict';

const app = require('../../server');
const async = require('async');
// load the list of locations
const locations = require('../../config/locations/locations');

/**
 * Create locations recursively
 * @param parentLocationId
 * @param locations
 * @param callback
 */
function createLocations(parentLocationId, locations, callback) {
  // build a list of create operations
  const createLocationOperations = [];
  locations.forEach(function (location) {
    // build current location
    let _location = {
      name: location.name,
      parentLocationId: parentLocationId
    };
    // add create location operation
    createLocationOperations.push(function (cb) {
      app.models.location
        .create(_location)
        .then(function (createdLocation) {
          // when done, if there are other sub-locations
          if (location.children && location.children.length) {
            // create them recursively
            createLocations(createdLocation.id, location.children, cb);
          } else {
            // otherwise just stop
            cb();
          }
        })
        .catch(cb)
    });
  });
  // run create operations
  async.series(createLocationOperations, callback);
}

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  createLocations(undefined, locations, callback);
}

module.exports = run;
