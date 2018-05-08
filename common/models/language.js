'use strict';

const app = require('../../server/server');

module.exports = function(Language) {
  // set flag to not get controller
  Language.hasController = false;

  // language tokens should not be managed via API
  app.utils.remote.disableRemoteMethods(Language, [
    'prototype.__create__languageTokens',
    'prototype.__delete__languageTokens',
    'prototype.__findById__languageTokens',
    'prototype.__updateById__languageTokens',
    'prototype.__destroyById__languageTokens',
  ]);
};
