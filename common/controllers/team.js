'use strict';

const app = require('../../server/server');

module.exports = function (Team) {

  // disable unneeded methods
  app.utils.remote.disableRemoteMethods(Team, [
    'prototype.__create__followUps',
    'prototype.__delete__followUps',
    'prototype.__updateById__followUps',
    'prototype.__destroyById__followUps'
  ]);

  /**
   * Do not allow deletion of teams that are currently in use
   * A team is in use if it has current or future follow-ups assigned
   */
  Team.beforeRemote('deleteById', function (context, modelInstance, next) {
    const today = new Date();
    today.setHours(0,0,0,0);
    app.models.followUp
      .count({
        teamId: context.args.id,
        date: {
          gte: today
        }
      })
      .then(function (count) {
        if (count) {
          throw app.utils.apiError.getError('MODEL_IN_USE', {model: Team.modelName, id: context.args.id});
        }
        next();
      })
      .catch(next);
  });
};
