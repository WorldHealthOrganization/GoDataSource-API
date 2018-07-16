'use strict';

const app = require('../../server');
// load the list of locations
const locations = require('../../config/locations/locations');

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  app.models.location.createLocationsFromHierarchicalLocationsList(undefined, locations, callback);
}

module.exports = run;
