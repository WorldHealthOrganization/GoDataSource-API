'use strict';

module.exports = function(ExtendedPersistedModel) {
  // set flag to force writing a controller for each model or update the flag
  ExtendedPersistedModel.hasController = true;
};
