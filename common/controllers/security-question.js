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
    // get available security questions categories
    app.models.referenceData
      .find({
        where: {
          categoryId: 'LNG_REFERENCE_DATA_CATEGORY_SECURITY_QUESTIONS_QUESTION'
        },
        fields: {
          id: true
        }
      })
      .then(function (questionItems) {
        // return if no question found
        if (!questionItems.length) {
          return callback(null, []);
        }

        // get questions
        const questionList = {};

        // add default entries for all questionItems
        questionItems.forEach(function (categoryItem) {
          questionList[categoryItem.id] = true;
        });

        // send result
        callback(null, Object.keys(questionList));
      })
      .catch(callback);
  };
};
