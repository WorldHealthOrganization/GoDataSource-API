'use strict';

const app = require('./../server/server');
const _ = require('lodash');
const uuid = require('uuid');
const helpers = require('./helpers');
const subTemplates = [
  'caseInvestigationTemplate',
  'contactInvestigationTemplate',
  'eventInvestigationTemplate',
  'caseFollowUpTemplate',
  'contactFollowUpTemplate',
  'labResultsTemplate'
];

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
      tokens.find.push(app.models.languageToken
        .findOne({
          where: {
            token: questions[qindex].text,
            languageId: languageId
          }
        })
        .then(function (token) {
          if (token) {
            // add it to the list only if translation is different
            if (token.translation !== originalValues[qindex].text) {
              // token exists update translation
              context.options.remotingContext.req.logger.debug(`Language token "${questions[qindex].text}" exists in DB. Updating it for the user language.`);
              tokens.updated.push(token.updateAttributes({
                translation: originalValues[qindex].text
              }, context.options));
            }
          } else {
            context.options.remotingContext.req.logger.debug(`Language token "${questions[qindex].text}" doesn't exist in DB. Creating it for all installed languages.`);
            // save question text language token
            tokens.new.push({
              token: questions[qindex].text,
              translation: originalValues[qindex].text
            });
          }
        })
      );

      // check for question answers as the label for each answer needs to be translated
      if (question.answers && Array.isArray(question.answers) && question.answers.length) {
        let answers = questions[qindex].answers;
        answers.forEach(function (answer, aindex) {
          tokens.find.push(app.models.languageToken
            .findOne({
              where: {
                token: answers[aindex].label,
                languageId: languageId
              }
            })
            .then(function (token) {
              // checking for the token; should always exist in this case
              if (token) {
                // add it to the list only if translation is different
                if (token.translation !== originalValues[qindex].answers[aindex].label) {
                  // token exists update translation
                  context.options.remotingContext.req.logger.debug(`Language token "${answers[aindex].label}" exists in DB. Updating it for the user language.`);
                  tokens.updated.push(token.updateAttributes({
                    translation: originalValues[qindex].answers[aindex].label
                  }, context.options));
                }
              } else {
                context.options.remotingContext.req.logger.debug(`Language token "${answers[aindex].label}" doesn't exist in DB. Creating it for all installed languages.`);
                // save answer label language token
                tokens.new.push({
                  token: answers[aindex].label,
                  translation: originalValues[qindex].answers[aindex].label
                });
              }
            })
          );

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
  // promises for finding tokens will be created on the fly
  // promises for created tokens will be created after checking all questions/answers;
  // promises for token update will be created on the fly
  let tokens = {
    find: [],
    new: [],
    updated: []
  };

  // depending on action (create/update) we need to check/update different context properties; parse the context to prevent additional checks
  let contextParts = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);

  // in the template only properties from subtemplates need to be translated
  subTemplates.forEach(function (subTemplate) {
    // check if the original subtemplates are set on the request; means that they have tokens to add in translations
    let originalSubtemplate = app.utils.helpers.getOriginalValueFromContextOptions(context, subTemplate);
    if (originalSubtemplate) {
      // get tokens
      getTokensFromQuestions(contextParts.target[subTemplate], originalSubtemplate, context.options.remotingContext.req.authData.user.languageId, tokens);
    }
  });

  // check if there are promises to be executed
  if (tokens.find.length) {
    // resolve promises
    Promise.all(tokens.find)
      .then(function () {
        // add the promises for token update into the tokenPromises array
        tokenPromises = tokenPromises.concat(tokens.updated);

        // check if there are new tokens to be added; in that case we need to retrieve all the languages
        if (tokens.new.length) {
          // get the languages list and create a token entry for each language
          return app.models.language.find();
        }
      })
      .then(function (languages) {
        if (languages) {
          // loop through all the languages and create new token promises for each language for each new token
          languages.forEach(function (language) {
            tokens.new.forEach(function (token) {
              // add languageId and create token
              token.languageId = language.id;
              tokenPromises.push(app.models.languageToken
                .create(token, context.options));
            });
          });
        }

        // resolve promises
        return Promise.all(tokenPromises);
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
 * @param next
 */
function beforeHook(context, next) {
  // do not execute hook on sync
  if (context.options && context.options._sync) {
    return next();
  }

  // in order to assure the language tokens to be unique, on create generate model ID and set it to the model
  let modelId;
  if (context.isNewInstance) {
    modelId = context.instance.id = (context.instance.id || uuid.v4());
  } else {
    modelId = context.currentInstance.id;
  }

  // initialize identifier
  let identifier = `LNG_${context.Model.modelName.toUpperCase()}_${modelId.toUpperCase()}`;

  // initialize duplicate question variable / answer value errors container
  let duplicateError = false;
  let duplicateErrors = {
    questions: {},
    answers: {}
  };

  // depending on action (create/update) we need to check/update different context properties; parse the context to prevent additional checks
  let contextParts = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);

  const templateId = _.get(context, 'options.remotingContext.req.query.templateId');
  if (templateId) {
    contextParts.tokenToTemplateTokenMap = {};
    app.models.template.findById(templateId)
      .then(template => {
        if (!template) {
          return next();
        }

        subTemplates.forEach(subTemplate => {
          if (template[subTemplate]) {
            contextParts.target[subTemplate] = JSON.parse(JSON.stringify(template[subTemplate]));

            const templateIdentifier = `${identifier}_${subTemplate.toUpperCase()}`;

            (function parse(questions, identifier) {
              identifier = identifier || '';

              questions.forEach((question, qIndex) => {
                const questionIdentifier = `${identifier}_QUESTION_${_.snakeCase(question.variable).toUpperCase()}`;

                contextParts.tokenToTemplateTokenMap[`${questionIdentifier}_TEXT`] = questions[qIndex].text;

                // set question text
                questions[qIndex].text = `${questionIdentifier}_TEXT`;

                // check for question answers as the label for each answer needs to be translated
                if (question.answers && Array.isArray(question.answers) && question.answers.length) {

                  let answers = questions[qIndex].answers;
                  answers.forEach(function (answer, aIndex) {

                    // set answer identifier
                    let answerIdentifier = `${questionIdentifier}_ANSWER_${_.snakeCase(answer.value).toUpperCase()}`;

                    contextParts.tokenToTemplateTokenMap[`${answerIdentifier}_LABEL`] = answers[aIndex].label;

                    // set answer label
                    answers[aIndex].label = `${answerIdentifier}_LABEL`;

                    // check for additional questions
                    if (answer.additionalQuestions && Array.isArray(answer.additionalQuestions) && answer.additionalQuestions.length) {
                      parse(answers[aIndex].additionalQuestions, answerIdentifier);
                    }
                  });
                }
              });
            })(contextParts.target[subTemplate], templateIdentifier);

            app.utils.helpers.setOriginalValueInContextOptions(context, 'tokenToTemplateTokenMap', contextParts.tokenToTemplateTokenMap);
          }
        });

        return next();
      });
  } else {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // in the template only properties from subtemplates need to be translated
    subTemplates.forEach(function (subTemplate) {
      // check if the subtemplates are sent in the request and they have questions
      if (contextParts.target && Array.isArray(contextParts.target[subTemplate]) && contextParts.target[subTemplate].length) {
        // store the original information to be used for translations
        app.utils.helpers.setOriginalValueInContextOptions(context, subTemplate, JSON.parse(JSON.stringify(contextParts.target[subTemplate])));

        // update identifier for subtemplate
        let templateIdentifier = `${identifier}_${subTemplate.toUpperCase()}`;

        // loop through the subtemplate questions to replace
        let questions = contextParts.target[subTemplate];

        // question variable must be unique in a template and answer value must be unique per question
        // initialize container with question variable/answer value counters
        let counters = {};

        // parse questions to replace text/answer label with tokens
        parseQuestions(questions, templateIdentifier, counters, !!templateId, context);

        // check counters
        Object.keys(counters).forEach(function (questionVariable) {
          // check questions
          if (counters[questionVariable].count > 1) {
            // question variable is used multiple times; add questionVariable to errors container
            duplicateError = true;
            duplicateErrors.questions[subTemplate] = duplicateErrors.questions[subTemplate] || [];
            duplicateErrors.questions[subTemplate].push(questionVariable);
          }

          // check question answers
          counters[questionVariable].answers && Object.keys(counters[questionVariable].answers).forEach(function (answerValue) {
            if (counters[questionVariable].answers[answerValue] > 1) {
              // answer value is used multiple times in question
              duplicateError = true;
              duplicateErrors.answers[subTemplate] = duplicateErrors.answers[subTemplate] || {[`question '${questionVariable}'`]: []};
              duplicateErrors.answers[subTemplate][`question '${questionVariable}'`].push(answerValue);
            }
          });
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
}

/**
 * After create/update hook
 * @param context
 * @param next
 */
function afterHook(context, next) {
  // do not execute hook on sync
  if (context.options && context.options._sync) {
    return next();
  }
  const tokenToTemplateTokenMap = app.utils.helpers.getOriginalValueFromContextOptions(context, 'tokenToTemplateTokenMap');
  if (tokenToTemplateTokenMap) {
    app.models.languageToken.find({
      where: {
        token: {
          inq: Object.values(tokenToTemplateTokenMap)
        }
      }
    }).then(tokens => {
      tokens = tokens.map(t => t.toJSON());
      const tokenPromises = [];
      for (let token in tokenToTemplateTokenMap) {
        const templateAssociatedTokens = tokens.filter(item => item.token === tokenToTemplateTokenMap[token]);
        templateAssociatedTokens.forEach(templateToken => {
          tokenPromises.push(new Promise((resolve, reject) => {
            app.models.languageToken
              .create({
                token: token,
                languageId: templateToken.languageId,
                translation: templateToken.translation
              }, context.options)
              .then(resolve)
              .catch(reject);
          }));
        });
      }
      return Promise.all(tokenPromises);
    }).then(() => next())
      .catch(next);
  } else {
    // after successfully creating/updating template, also create/update translations for it.
    saveLanguageTokens(context, next);
  }
}

/**
 * Order questions
 * @param questions
 */
function orderQuestions(questions) {
  // check if there are questions
  if (Array.isArray(questions)) {
    // sort them using order
    questions.sort(function (a, b) {
      // make sure we're working with numbers
      a.order = parseInt(a.order);
      b.order = parseInt(b.order);
      // set defaults for order
      if (isNaN(a.order)) {
        a.order = 1;
      }
      if (isNaN(b.order)) {
        b.order = 1;
      }
      return a.order - b.order;
    });
    // go through each question
    questions.forEach(function (question) {
      // check if there are predefined answers
      if (Array.isArray(question.answers)) {
        // go through the predefined answers
        question.answers.forEach(function (answer) {
          // order additional questions
          orderQuestions(answer.additionalQuestions);
        });
      }
    });
  }
}

module.exports = {
  beforeHook: beforeHook,
  afterHook: afterHook,
  extractVariablesAndAnswerOptions: helpers.extractVariablesAndAnswerOptions,
  orderQuestions: orderQuestions
};
