'use strict';

const app = require('../../server/server');

module.exports = function (Team) {

  Team.locationFields = [
    'locationIds'
  ];

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

  /**
   * After save hook
   * @param ctx
   * @param next
   */
  Team.observe('after save', function (ctx, next) {
    // reset user cache
    app.models.user.cache.reset();

    return next();
  });

  /**
   * After delete hook
   * @param ctx
   * @param next
   */
  Team.observe('after delete', function (ctx, next) {
    // reset user cache
    app.models.user.cache.reset();

    return next();
  });
};
