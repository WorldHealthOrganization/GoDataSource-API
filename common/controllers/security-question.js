'use strict';

const app = require('../../server/server');

module.exports = function (SecurityQuestion) {

  // Only list endpoint
  app.utils.remote.disableRemoteMethods(SecurityQuestion, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'count',
    'find'
  ]);

  SecurityQuestion.getQuestions = function (callback) {
    return callback(null, SecurityQuestion.questions);
  };
};
