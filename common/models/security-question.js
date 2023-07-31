'use strict';

module.exports = function(SecurityQuestion) {
  // hidden fields safe for import
  SecurityQuestion.safeForImportHiddenFields = [
    'answer'
  ];

  // define available categories
  SecurityQuestion.questions = [
    'LNG_SECURITY_QUESTION_1',
    'LNG_SECURITY_QUESTION_2',
    'LNG_SECURITY_QUESTION_3',
    'LNG_SECURITY_QUESTION_4',
    'LNG_SECURITY_QUESTION_5',
    'LNG_SECURITY_QUESTION_6',
    'LNG_SECURITY_QUESTION_7',
    'LNG_SECURITY_QUESTION_8',
    'LNG_SECURITY_QUESTION_9',
    'LNG_SECURITY_QUESTION_10'
  ];
};
