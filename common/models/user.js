'use strict';

const app = require('../../server/server');

module.exports = function(User) {
  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');

};
