'use strict';

const config = require('./../server/config.json');

/**
 * Remove access tokens on startup if needed
 * @param {Object} logger - Logger instance
 */
module.exports = function (logger) {
  if (config.signoutUsersOnRestart) {
    const MongoDBHelper = require('./mongoDBHelper');
    MongoDBHelper
      .executeAction('accessToken', 'remove', [{}])
      .then(() => {
        logger.debug('Success removing existing access tokens on restart');
      })
      .catch(err => {
        logger.error(`Failed removing existing access tokens on restart: ${err}`);
      });
  }
};
