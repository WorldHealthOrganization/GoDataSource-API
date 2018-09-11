'use strict';

const app = require('./../server/server');
const _ = require('lodash');
const uuid = require('uuid');
const subTemplates = ['caseInvestigationTemplate', 'contactFollowUpTemplate', 'labResultsTemplate'];

/**
 * Parse template questions to replace text/labels with language tokens
 * @param questions Array of questions
 * @param identifier Language token identifier prefix
 * @param counters Container for question variable/answer value counters
 */
function parseQuestions(questions, identifier, counters) {
  identifier = identifier || '';

  questions.forEach(function (question, qindex) {
    // increase question variable counter
    counters[question.variable] = counters[question.variable] || {count: 0};
    // increase usage counter
    counters[question.variable].count++;

    // set question identifier
    let questionIdentifier = `${identifier}_QUESTION_${_.snakeCase(question.variable).toUpperCase()}`;

    // set question text
    questions[qindex].text = `${questionIdentifier}_TEXT`;

    // check for question answers as the label for each answer needs to be translated
    if (question.answers && Array.isArray(question.answers) && question.answers.length) {
      // initialize question answer values counter
      counters[question.variable].answers = counters[question.variable].answers || {};

      let answers = questions[qindex].answers;
      answers.forEach(function (answer, aindex) {
        // increase answer counter
        counters[question.variable].answers[answer.value] = counters[question.variable].answers[answer.value] || 0;
        counters[question.variable].answers[answer.value]++;

        // set answer identifier
        let answerIdentifier = `${questionIdentifier}_ANSWER_${_.snakeCase(answer.value).toUpperCase()}`;

        // set answer label
        answers[aindex].label = `${answerIdentifier}_LABEL`;

        // check for additional questions
        if (answer.additionalQuestions && Array.isArray(answer.additionalQuestions) && answer.additionalQuestions.length) {
          parseQuestions(answers[aindex].additionalQuestions, answerIdentifier, counters);
        }
      });
    }
  });
}

/**
 * Loop through template questions to get and save language tokens
 * @param context
 * @param next
 */
function saveLanguageTokens(context, next) {
  /**
   * Loop through template questions to get language tokens
   * @param questions Array of questions containing the replaced values with tokens
   * @param originalValues Array of questions containing the original request values
   * @param languageId LanguageId for the tokens that need to updated
   * @param tokens Object containing 2 arrays for new token resources and updated token resources
   */
  function getTokensFromQuestions(questions, originalValues, languageId, tokens) {

    // loop through all the questions to create/update tokens
    questions.forEach(function (question, qindex) {
      // check if question is new
      if (question.new === true) {
        // save question text language token
        tokens.new.push({
          token: questions[qindex].text,
          translation: originalValues[qindex].text
        });
      } else {
        // question already exists in template; update translation
        tokens.updated.push(app.models.languageToken
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
              }, context.args.options);
            } else {
              context.req.logger.debug(`Language token "${questions[qindex].text}" doesn't exist in DB. Should have been in the DB. Recreating it.`);
              // shouldn't get here
              return tokens.notFound.push(app.models.languageToken
                .create({
                  id: app.models.languageToken.generateID(questions[qindex].text, languageId),
                  token: questions[qindex].text,
                  translation: originalValues[qindex].text,
                  languageId: languageId
                }, context.args.options));
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
            tokens.new.push({
              token: answers[aindex].label,
              translation: originalValues[qindex].answers[aindex].label
            });
          } else {
            // answer already exists in template; update translation
            tokens.updated.push(app.models.languageToken
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
                  }, context.args.options);
                } else {
                  context.req.logger.debug(`Language token "${answers[aindex].label}" doesn't exist in DB. Should have been in the DB. Recreating it only for the user's language.`);
                  // shouldn't get here
                  return tokens.notFound.push(app.models.languageToken
                    .create({
                      id: app.models.languageToken.generateID(answers[aindex].label, languageId),
                      token: answers[aindex].label,
                      translation: originalValues[qindex].answers[aindex].label,
                      languageId: languageId
                    }, context.args.options));
                }
              })
            );
          }

          // check for additional questions
          if (answer.additionalQuestions && Array.isArray(answer.additionalQuestions) && answer.additionalQuestions.length) {
            getTokensFromQuestions(answers[aindex].additionalQuestions, originalValues[qindex].answers[aindex].additionalQuestions, languageId, tokens);
          }
        });
      }
    });
  }

  // initialize array of language token create/update promises
  let tokenPromises = [];

  // need to save tokens for all languages and update tokens only for the user's language
  // initialize object containing arrays of token resources that will need to be created/updated
  // promises for created tokens will be created after checking all questions/answers;
  // promises for token update will be created on the fly
  // promises for not found tokens will be added after the new/updated promises are executed
  let tokens = {
    new: [],
    updated: [],
    notFound: []
  };

  // in the template only properties from subtemplates need to be translated
  subTemplates.forEach(function (subTemplate) {
    // check if the original subtemplates are set on the request; means that they have tokens to add in translations
    if (context.req[`_original${subTemplate}`]) {
      // get tokens
      getTokensFromQuestions(context.args.data[subTemplate], context.req[`_original${subTemplate}`], context.req.authData.user.languageId, tokens);
    }
  });

  // add the promises for token update into the tokenPromises array
  tokenPromises = tokenPromises.concat(tokens.updated);

  // check if new language tokens need to be created
  if (tokens.new.length) {
    // get the languages list and create a token entry for each language
    app.models.language
      .find()
      .then(function (languages) {
        // loop through all the languages and create new token promises for each language for each new token
        languages.forEach(function (language) {
          tokens.new.forEach(function (token) {
            // add ID to the token
            token.id = app.models.languageToken.generateID(token.token, language.id);
            // add languageId and create token
            token.languageId = language.id;
            tokenPromises.push(app.models.languageToken
              .create(token, context.args.options));
          });
        });

        // resolve promises
        return Promise.all(tokenPromises);
      })
      .then(function () {
        // check if there are tokens that need to be recreated (were not found in DB)
        if (tokens.notFound.length) {
          // resolve promises
          return Promise.all(tokens.notFound);
        }

        return tokens.notFound.length;
      })
      .then(function () {
        next();
      })
      .catch(next);
  } else if (tokenPromises.length) {
    // no new token but there are tokens to be updated
    Promise.all(tokenPromises)
      .then(function () {
        // check if there are tokens that need to be recreated (were not found in DB)
        if (tokens.notFound.length) {
          // resolve promises
          return Promise.all(tokens.notFound);
        }

        return tokens.notFound.length;
      })
      .then(function () {
        next();
      })
      .catch(next);
  } else {
    next();
  }
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
  if (context.req.method === 'POST') {
    modelId = context.args.data.id = uuid.v4();
  } else {
    modelId = context.instance.id;
  }

  // initialize identifier
  let identifier = `LNG_${context.method.sharedClass.name.toUpperCase()}_${modelId.toUpperCase()}`;

  // initialize duplicate question variable / answer value errors container
  let duplicateError = false;
  let duplicateErrors = {
    questions: {},
    answers: {}
  };

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

      // question variable must be unique in a template and answer value must be unique per question
      // initialize container with question variable/answer value counters
      let counters = {};

      // parse questions to replace text/answer label with tokens
      parseQuestions(questions, templateIdentifier, counters);

      // check counters
      Object.keys(counters).forEach(function (questionVariable) {
        if (counters[questionVariable].count > 1) {
          // question variable is used multiple times; add questionVariable to errors container
          duplicateError = true;
          duplicateErrors.questions[subTemplate] = duplicateErrors.questions[subTemplate] || [];
          duplicateErrors.questions[subTemplate].push(questionVariable);

          // check question answers
          counters[questionVariable].answers && Object.keys(counters[questionVariable].answers).forEach(function (answerValue) {
            if (counters[questionVariable].answers[answerValue] > 1) {
              // answer value is used multiple times in question
              duplicateError = true;
              duplicateErrors.answers[subTemplate] = duplicateErrors.answers[subTemplate] || {[`question ${questionVariable}`]: []};
              duplicateErrors.answers[subTemplate][`question ${questionVariable}`].push(answerValue);
            }
          });
        }
      });
    }
  });

  // check for duplicate questions/answers error
  if (duplicateError) {
    next(app.utils.apiError.getError('DUPLICATE_TEMPLATE_QUESTION_VARIABLE_OR_ANSWER_VALUE', {
      duplicateQuestionVariable: duplicateErrors.questions,
      duplicateAnswerValue: duplicateErrors.answers
    }));
  } else {
    next();
  }
}

/**
 * After create/update hook
 * @param context
 * @param modelInstance
 * @param next
 */
function afterHook(context, modelInstance, next) {
  // after successfully creating/updating template, also create/update translations for it.
  saveLanguageTokens(context, function (error) {
    if (error) {
      return next(error);
    }
    // get JSON model
    const jsonInstance = modelInstance.toJSON();
    // store data to be updated
    const updatedData = {};
    // go trough all sub-templates and reset new flag
    subTemplates.forEach(function (templateName) {
      updatedData[templateName] = resetTemplateNewFlag(jsonInstance[templateName]);
    });
    // then update the instance with reset flags
    modelInstance
      .updateAttributes(updatedData, context.args.options)
      .then(function () {
        next();
      })
      .catch(next);
  });
}

/**
 * Reset 'new' flag for question and answers within a template
 * @param template
 * @return {array}
 */
function resetTemplateNewFlag(template) {
  // work with a copy of the template
  template = JSON.parse(JSON.stringify(template));
  // template should be an array of questions
  if (Array.isArray(template)) {
    // go through all the questions
    template.forEach(function (question) {
      // reset new flag
      question.new = false;
      // if the question has predefined answers
      if (Array.isArray(question.answers)) {
        // go through all answers
        question.answers.forEach(function (answer) {
          // reset new flag
          answer.new = false;
          // if there are additional questions inside an answer
          if (Array.isArray(answer.additionalQuestions)) {
            // parse them recursively
            answer.additionalQuestions = resetTemplateNewFlag(answer.additionalQuestions);
          }
        });
      }
    });
  }
  return template;
}

/**
 * Extract a list of variables and their answers (if any) from a template
 * @param template
 * @return {Array}
 */
function extractVariablesAndAnswerOptions(template) {
  // store a list of variables
  let variables = [];
  // template should be an array of questions
  if (Array.isArray(template)) {
    // go through all the questions
    template.forEach(function (question) {
      // start building the variable
      const variable = {
        name: question.variable,
        text: question.text,
        answerType: question.answerType
      };
      // if the question has predefined answers
      if (
        ['LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER',
          'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS'
        ].includes(question.answerType) &&
        Array.isArray(question.answers)
      ) {
        // store a list of variables
        variable.answers = [];
        // go through the list of answers
        question.answers.forEach(function (answer) {
          // store them
          variable.answers.push({
            label: answer.label,
            value: answer.value
          });
          // if there are additional questions inside an answer
          if (Array.isArray(answer.additionalQuestions)) {
            // parse them recursively
            variables = variables.concat(extractVariablesAndAnswerOptions(answer.additionalQuestions));
          }
        });
      }
      // store variable in the list of variables
      variables.push(variable);
    });
  }
  return variables;
}

module.exports = {
  beforeHook: beforeHook,
  afterHook: afterHook,
  extractVariablesAndAnswerOptions: extractVariablesAndAnswerOptions
};
