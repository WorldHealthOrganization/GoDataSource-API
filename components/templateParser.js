'use strict';

const app = require('./../server/server');
const _ = require('lodash');
const uuid = require('uuid');
const subTemplates = ['caseInvestigationTemplate', 'contactFollowUpTemplate', 'labResultsTemplate'];

/**
 * Parse template questions to replace text/labels with language tokens
 * @param questions Array of questions
 * @param identifier Language token identifier prefix
 */
function parseQuestions(questions, identifier) {
  identifier = identifier || '';

  questions.forEach(function (question, qindex) {
    // set question identifier
    let questionIdentifier = `${identifier}_QUESTION_${_.snakeCase(question.variable).toUpperCase()}`;

    // set question text
    questions[qindex].text = `${questionIdentifier}_TEXT`;

    // check for question answers as the label for each answer needs to be translated
    if (question.answers && Array.isArray(question.answers) && question.answers.length) {
      let answers = questions[qindex].answers;
      answers.forEach(function (answer, aindex) {
        // set answer identifier
        let answerIdentifier = `${questionIdentifier}_ANSWER_${_.snakeCase(answer.value).toUpperCase()}`;

        // set answer label
        answers[aindex].label = `${answerIdentifier}_LABEL`;

        // check for additional questions
        if (answer.additionalQuestions && Array.isArray(answer.additionalQuestions) && answer.additionalQuestions.length) {
          parseQuestions(answers[aindex].additionalQuestions, answerIdentifier);
        }
      });
    }
  });
}

/**
 * Loop through template questions to get and save language tokens
 * @param questions Array of questions containing the replaced values with tokens
 * @param originalValues Array of questions containing the original request values
 * @param languageId LanguageId for the tokens
 * @param promises Array of promises to be updated with new create/modify token promises
 */
function saveLanguageTokens(questions, originalValues, languageId, promises) {
  promises = promises || [];

  questions.forEach(function (question, qindex) {
    // check if question is new
    if (question.new === true) {
      // save question text language token
      promises.push(app.models.languageToken
        .create({
          token: questions[qindex].text,
          languageId: languageId,
          translation: originalValues[qindex].text
        })
      );
    } else {
      // question already exists in template; update translation
      promises.push(app.models.languageToken
        .findOne({
          where: {
            token: questions[qindex].text,
            languageId: languageId
          }
        })
        .then(function (token) {
          // checking for the token; should always exist in this case
          if (token) {
            return token.updateAttributes({
              translation: originalValues[qindex].text
            });
          } else {
            // shouldn't get here
            return app.models.languageToken
              .create({
                token: questions[qindex].text,
                languageId: languageId,
                translation: originalValues[qindex].text
              });
          }
        })
      );
    }

    // check for question answers as the label for each answer needs to be translated
    if (question.answers && Array.isArray(question.answers) && question.answers.length) {
      let answers = questions[qindex].answers;
      answers.forEach(function (answer, aindex) {
        // check if answer is new
        if (answer.new === true) {
          // save answer label language token
          promises.push(app.models.languageToken
            .create({
              token: answers[aindex].label,
              languageId: languageId,
              translation: originalValues[qindex].answers[aindex].label
            })
          );
        } else {
          // answer already exists in template; update translation
          promises.push(app.models.languageToken
            .findOne({
              where: {
                token: answers[aindex].label,
                languageId: languageId
              }
            })
            .then(function (token) {
              // checking for the token; should always exist in this case
              if (token) {
                return token.updateAttributes({
                  translation: originalValues[qindex].answers[aindex].label
                });
              } else {
                // shouldn't get here
                return app.models.languageToken
                  .create({
                    token: answers[aindex].label,
                    languageId: languageId,
                    translation: originalValues[qindex].answers[aindex].label
                  });
              }
            })
          );
        }

        // check for additional questions
        if (answer.additionalQuestions && Array.isArray(answer.additionalQuestions) && answer.additionalQuestions.length) {
          saveLanguageTokens(answers[aindex].additionalQuestions, originalValues[qindex].answers[aindex].additionalQuestions, languageId, promises);
        }
      });
    }
  });
}

/**
 * Before create/update hook
 * @param context
 * @param modelInstance
 * @param next
 */
function beforeHook(context, modelInstance, next) {
  // in order to assure the language tokens to be unique, on create generate model ID and set it to the model
  let modelId;
  if(context.req.method === 'POST') {
    modelId = context.args.data.id = uuid.v4();
  } else {
    modelId = context.instance.id;
  }

  // initialize identifier
  let identifier = `LNG_TEMPLATE_${modelId.toUpperCase()}`;

  // in order to translate dynamic data, don't store values in the database, but translatable language tokens
  // in the template only properties from subtemplates need to be translated
  subTemplates.forEach(function (subTemplate) {
    // check if the subtemplates are sent in the request and they have questions
    if (context.args.data && Array.isArray(context.args.data[subTemplate]) && context.args.data[subTemplate].length) {
      // store the original information to be used for translations
      context.req[`_original${subTemplate}`] = JSON.parse(JSON.stringify(context.args.data[subTemplate]));

      // update identifier for subtemplate
      let templateIdentifier = `${identifier}_${subTemplate.toUpperCase()}`;

      // loop through the subtemplate questions to replace
      let questions = context.args.data[subTemplate];

      // parse questions to replate text/answer label with tokens
      parseQuestions(questions, templateIdentifier);
    }
  });

  next();
}

/**
 * After create/update hook
 * @param context
 * @param modelInstance
 * @param next
 */
function afterHook(context, modelInstance, next) {
  // after successfully creating/updating template, also create/update translations for it.
  // initialize array of language token create/update promises
  let tokenPromises = [];

  // in the template only properties from subtemplates need to be translated
  subTemplates.forEach(function (subTemplate) {
    // check if the original subtemplates are set on the request; means that they have tokens to add in translations
    if (context.req[`_original${subTemplate}`]) {
      saveLanguageTokens(context.args.data[subTemplate], context.req[`_original${subTemplate}`], context.req.authData.user.languageId, tokenPromises);
    }
  });

  // check if there are promises to be resolved
  if (tokenPromises.length) {
    Promise.all(tokenPromises)
      .then(function () {
        next();
      })
      .catch(next);
  } else {
    next();
  }
}

module.exports = {
  beforeHook: beforeHook,
  afterHook: afterHook
};
