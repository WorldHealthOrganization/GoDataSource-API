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
};
