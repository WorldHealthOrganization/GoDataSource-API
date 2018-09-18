'use strict';

const app = require('../../server');
// load the list of locations
const locations = require('../../config/locations/locations');

// initialize action options; set _init flag to prevent execution of some after save scripts
let options = {
  _init: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  app.models.location.createLocationsFromHierarchicalLocationsList(undefined, locations, options, callback);
}

module.exports = run;
