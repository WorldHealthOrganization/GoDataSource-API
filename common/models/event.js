'use strict';

module.exports = function (Event) {
  // set flag to not get controller
  Event.hasController = false;

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Event.nestedGeoPoints = [
    'address.geoLocation'
  ];
};
