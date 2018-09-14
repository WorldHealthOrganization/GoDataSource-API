'use strict';

module.exports = function(Maps) {
  // set flag to force using the controller
  Maps.hasController = true;

  // script's content stored as buffer into memory, for consequent requests
  // we do this to save network time
  Maps.scriptBuffer = null;

  // script's path
  Maps.scriptPath = 'https://maps.googleapis.com/maps/api/js?key=';
};
