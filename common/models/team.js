'use strict';

module.exports = function (Team) {

  // define a list of custom (non-loopback-supported) relations
  Team.customRelations = {
    members: {
      type: 'belongsToMany',
      model: 'user',
      foreignKey: 'userIds'
    },
    locations: {
      type: 'belongsToMany',
      model: 'location',
      foreignKey: 'locationIds'
    }
  };

  // initialize model helpers
  Team.helpers = {};

  // get matching teams for a list of location/sub locations
  Team.helpers.getTeamsByLocationId = function (locationId, callback) {

  };
};
