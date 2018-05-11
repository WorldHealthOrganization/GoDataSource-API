'use strict';

module.exports = function(TemplateQuestion) {

  TemplateQuestion.answerType = {
    freeText: 'LNG_TEMPLATE_QUESTION_ANSWER_TYPE_FREE_TEXT',
    numeric: 'LNG_TEMPLATE_QUESTION_ANSWER_TYPE_NUMERIC',
    dateTime: 'LNG_TEMPLATE_QUESTION_ANSWER_TYPE_DATE_TIME',
    singleAnswer: 'LNG_TEMPLATE_QUESTION_ANSWER_TYPE_SINGLE_ANSWER',
    multipleAnswer: 'LNG_TEMPLATE_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWER'
  };
};
