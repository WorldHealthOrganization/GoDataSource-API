'use strict';

const app = require('../../server/server');

module.exports = function(Role) {
  app.utils.remote.disableStandardRelationRemoteMethods(Role, 'principals');
};
