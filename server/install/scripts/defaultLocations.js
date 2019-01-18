'use strict';

const app = require('../../server');
const common = require('./_common');

// load the list of locations
const locations = require('../../config/locations/locations');

// initialize action options; set _init flag to prevent execution of some after save scripts
let options = {
  _init: true
};

// set default timestamps
(function setDefaultTimestamps(locationsList) {
  locationsList.forEach(function (location) {
    Object.assign(location.location, common.install.timestamps);
    if (location.children && location.children.length) {
      setDefaultTimestamps(location.children);
    }
  });
})(locations);

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  app.models.location.createLocationsFromHierarchicalLocationsList(undefined, locations, options, callback);
}

module.exports = run;
