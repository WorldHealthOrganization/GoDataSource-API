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

  // default export order
  Team.exportFieldsOrder = [
    'id'
  ];

  Team.arrayProps = {
    userIds: 'LNG_TEAM_FIELD_LABEL_USERS',
    locationIds: 'LNG_TEAM_FIELD_LABEL_LOCATIONS'
  };

  Team.fieldLabelsMap = Object.assign({}, Team.fieldLabelsMap, {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdOn: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_ON',
    createdAt: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT',
    name: 'LNG_TEAM_FIELD_LABEL_NAME',
    userIds: 'LNG_TEAM_FIELD_LABEL_USERS',
    locationIds: 'LNG_TEAM_FIELD_LABEL_LOCATIONS'
  });
};
