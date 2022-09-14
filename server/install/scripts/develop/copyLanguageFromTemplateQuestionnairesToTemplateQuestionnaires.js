'use strict';

// deps
const MongoDBHelper = require('../../../../components/mongoDBHelper');
const DataSources = require('../../../datasources');
const _ = require('lodash');
const async = require('async');

// script's entry point
const run = function (cb) {
  // compared questionnaires
  const questionnaireKeys = [
    'caseInvestigationTemplate',
    'contactInvestigationTemplate',
    'contactFollowUpTemplate',
    'labResultsTemplate'
  ];

  // db connection
  let dbConnection;

  // create Mongo DB connection
  MongoDBHelper
    .getMongoDBConnection({
      ignoreUndefined: DataSources.mongoDb.ignoreUndefined
    })
    .then((dbConn) => {
      // save for later use
      dbConnection = dbConn;

      // retrieve source & destination templates
      return dbConnection.collection('template')
        .find({
          deleted: false,
          name: {
            $in: [
              module.methodRelevantArgs.sourceTemplate,
              module.methodRelevantArgs.destinationTemplate
            ]
          }
        })
        .toArray();
    })
    .then((templates) => {
      // did we find what we were looking for
      if (
        !templates ||
        templates.length !== 2
      ) {
        return console.error('Invalid data provided');
      }

      // determine source & destination templates
      const sourceTemplate = templates[0].name === module.methodRelevantArgs.sourceTemplate ?
        templates[0] :
        templates[1];
      const destinationTemplate = templates[0].name === module.methodRelevantArgs.destinationTemplate ?
        templates[0] :
        templates[1];

      // source & destination should be different
      if (sourceTemplate._id === destinationTemplate._id) {
        return console.error('Invalid data provided');
      }

      // determine source & destination language tokens
      const sourceLanguageTokens = {};
      const destinationLanguageTokens = {};
      questionnaireKeys.forEach((questionnaireKey) => {
        // go through questions
        const goThroughQuestions = (
          accumulator,
          questions
        ) => {
          _.each(questions, (question) => {
            // question
            accumulator[question.text] = true;

            // go through answers
            if (
              question.answers &&
              question.answers.length > 0
            ) {
              // answers
              _.each(question.answers, (answer) => {
                // answer
                accumulator[answer.label] = true;

                // go through answer questions
                if (
                  answer.additionalQuestions &&
                  answer.additionalQuestions.length > 0
                ) {
                  goThroughQuestions(
                    accumulator,
                    answer.additionalQuestions
                  );
                }
              });
            }
          });
        };

        // source
        if (sourceTemplate[questionnaireKey]) {
          // go through questions and answers
          sourceLanguageTokens[questionnaireKey] = {};
          goThroughQuestions(
            sourceLanguageTokens[questionnaireKey],
            sourceTemplate[questionnaireKey]
          );
        }

        // destination
        if (destinationTemplate[questionnaireKey]) {
          // go through questions and answers
          destinationLanguageTokens[questionnaireKey] = {};
          goThroughQuestions(
            destinationLanguageTokens[questionnaireKey] = {},
            destinationTemplate[questionnaireKey]
          );
        }
      });

      // finished
      return {
        sourceLanguageTokens,
        destinationLanguageTokens,
        sourceTemplate,
        destinationTemplate
      };
    })
    .then((data) => {
      // nothing to do ?
      if (!data) {
        return;
      }

      // determine source tokens for which we need to retrieve all default language translations
      const allTokens = [];
      _.each(data.sourceLanguageTokens, (tokens) => {
        allTokens.push(...Object.keys(tokens));
      });

      // determine destination tokens for which we need to retrieve all default language translations
      _.each(data.destinationLanguageTokens, (tokens) => {
        allTokens.push(...Object.keys(tokens));
      });

      // retrieve source tokens
      return dbConnection.collection('language')
        .find({
          deleted: false
        }, {
          projection: {
            _id: 1
          }
        })
        .toArray()
        .then((languages) => {
          return dbConnection.collection('languageToken')
            .find({
              token: {
                $in: allTokens
              },
              languageId: {
                $in: languages.map((lang) => lang._id)
              }
            }, {
              projection: {
                _id: 1,
                languageId: 1,
                token: 1,
                translation: 1
              }
            })
            .toArray();
        })
        .then((langTokens) => {
          return {
            langTokens,
            sourceTemplate: data.sourceTemplate,
            destinationTemplate: data.destinationTemplate,
            sourceLanguageTokens: data.sourceLanguageTokens,
            destinationLanguageTokens: data.destinationLanguageTokens
          };
        });
    })
    .then((data) => {
      // nothing to do
      if (
        !data.langTokens ||
        data.langTokens.length < 1
      ) {
        // finished
        cb();
        return;
      }

      // map language tokens
      const langTokensMap = {};
      data.langTokens.forEach((tokenData) => {
        // must initialize token ?
        if (!langTokensMap[tokenData.languageId]) {
          langTokensMap[tokenData.languageId] = {};
        }

        // set data
        langTokensMap[tokenData.languageId][tokenData.token] = tokenData;
      });

      // compare and construct the create / update language tokens
      const tokenUpdateJobs = [];
      const compareLanguage = module.methodRelevantArgs.compareLanguage;
      const findAndUpdateQuestionsAndAnswers = (
        sourceData,
        destinationData,
        key
      ) => {
        (sourceData || []).forEach((sourceItem) => {
          (destinationData || []).forEach((destinationItem) => {
            // same question translation ?
            if (
              sourceItem[key] &&
              destinationItem[key] &&
              langTokensMap[compareLanguage] &&
              langTokensMap[compareLanguage][sourceItem[key]] &&
              langTokensMap[compareLanguage][destinationItem[key]] &&
              langTokensMap[compareLanguage][sourceItem[key]].translation &&
              langTokensMap[compareLanguage][destinationItem[key]].translation &&
              langTokensMap[compareLanguage][sourceItem[key]].translation.trim().toLowerCase() === langTokensMap[compareLanguage][destinationItem[key]].translation.trim().toLowerCase()
            ) {
              // check the other languages if they are different
              _.each(langTokensMap, (languageMap, languageId) => {
                // ignore compare language
                if (languageId === compareLanguage) {
                  return;
                }

                // check translations
                if (
                  langTokensMap[languageId][sourceItem[key]] &&
                  langTokensMap[languageId][destinationItem[key]] &&
                  langTokensMap[languageId][sourceItem[key]].translation &&
                  langTokensMap[languageId][destinationItem[key]].translation &&
                  langTokensMap[languageId][sourceItem[key]].translation.trim().toLowerCase() !== langTokensMap[languageId][destinationItem[key]].translation.trim().toLowerCase()
                ) {
                  // log message
                  console.log(`Should update ${languageId}: '${langTokensMap[languageId][destinationItem[key]].translation}' to '${langTokensMap[languageId][sourceItem[key]].translation}'`);

                  // create update job
                  (function (
                    tokenId,
                    tokenOldTranslation,
                    tokenNewTranslation
                  ) {
                    tokenUpdateJobs.push((childCallback) => {
                      // log
                      console.log(`Updating token '${tokenId}' from '${tokenOldTranslation}' to '${tokenNewTranslation}'`);

                      // update
                      dbConnection.collection('languageToken')
                        .updateOne({
                          _id: tokenId
                        }, {
                          '$set': {
                            translation: tokenNewTranslation
                          }
                        })
                        .then(() => {
                          // log
                          console.log(`Finished updating token '${tokenId}' from '${tokenOldTranslation}' to '${tokenNewTranslation}'`);

                          // finished
                          childCallback();
                        })
                        .catch(childCallback);
                    });
                  })(
                    langTokensMap[languageId][destinationItem[key]]._id,
                    langTokensMap[languageId][destinationItem[key]].translation,
                    langTokensMap[languageId][sourceItem[key]].translation
                  );
                }

                // compare children answers
                if (
                  sourceItem.answers &&
                  sourceItem.answers.length > 0 &&
                  destinationItem.answers &&
                  destinationItem.answers.length > 0
                ) {
                  findAndUpdateQuestionsAndAnswers(
                    sourceItem.answers,
                    destinationItem.answers,
                    'label'
                  );
                } else if (
                  sourceItem.additionalQuestions &&
                  sourceItem.additionalQuestions.length > 0 &&
                  destinationItem.additionalQuestions &&
                  destinationItem.additionalQuestions.length > 0
                ) {
                  findAndUpdateQuestionsAndAnswers(
                    sourceItem.additionalQuestions,
                    destinationItem.additionalQuestions,
                    'text'
                  );
                }
              });
            }
          });
        });
      };

      // compare questionnaires
      questionnaireKeys.forEach((questionnaireKey) => {
        findAndUpdateQuestionsAndAnswers(
          data.sourceTemplate[questionnaireKey],
          data.destinationTemplate[questionnaireKey],
          'text'
        );
      });

      // should we force deep search ?
      if (module.methodRelevantArgs.deepSearch) {
        // log
        console.log('Proceeding for deep search...');

        // map compareLanguage source translations to other language translations
        const compareLanguageMap = {};
        _.each(data.sourceLanguageTokens, (templateTokens) => {
          _.each(templateTokens, (NOTHING, langToken) => {
            if (
              langTokensMap[compareLanguage] &&
              langTokensMap[compareLanguage][langToken] &&
              langTokensMap[compareLanguage][langToken].translation &&
              langTokensMap[compareLanguage][langToken].translation.trim()
            ) {
              // check the other languages if they are different
              _.each(langTokensMap, (languageMap, languageId) => {
                // ignore compare language
                if (
                  languageId === compareLanguage ||
                  !langTokensMap[languageId][langToken] ||
                  !langTokensMap[languageId][langToken].translation ||
                  !langTokensMap[languageId][langToken].translation.trim()
                ) {
                  return;
                }

                // initialize ?
                if (!compareLanguageMap[langTokensMap[compareLanguage][langToken].translation.trim().toLowerCase()]) {
                  compareLanguageMap[langTokensMap[compareLanguage][langToken].translation.trim().toLowerCase()] = {};
                }

                // map translation
                compareLanguageMap[langTokensMap[compareLanguage][langToken].translation.trim().toLowerCase()][languageId] = langTokensMap[languageId][langToken].translation.trim();
              });
            }
          });
        });

        // go through each template
        _.each(data.destinationLanguageTokens, (templateTokens) => {
          _.each(templateTokens, (NOTHING, langToken) => {
            // check if we have other translations for this item compare language translation
            if (
              langTokensMap[compareLanguage][langToken] &&
              langTokensMap[compareLanguage][langToken].translation &&
              langTokensMap[compareLanguage][langToken].translation.trim() &&
              compareLanguageMap[langTokensMap[compareLanguage][langToken].translation.trim().toLowerCase()]
            ) {
              _.each(compareLanguageMap[langTokensMap[compareLanguage][langToken].translation.trim().toLowerCase()], (translation, languageId) => {
                if (langTokensMap[languageId][langToken].translation.trim().toLowerCase() !== translation.trim().toLowerCase()) {
                  // log message
                  console.log(`Deep: Should update ${languageId}: '${langTokensMap[languageId][langToken].translation}' to '${translation}'`);

                  // create update job
                  (function (
                    tokenId,
                    tokenOldTranslation,
                    tokenNewTranslation
                  ) {
                    tokenUpdateJobs.push((childCallback) => {
                      // log
                      console.log(`Deep: Updating token '${tokenId}' from '${tokenOldTranslation}' to '${tokenNewTranslation}'`);

                      // update
                      dbConnection.collection('languageToken')
                        .updateOne({
                          _id: tokenId
                        }, {
                          '$set': {
                            translation: tokenNewTranslation
                          }
                        })
                        .then(() => {
                          // log
                          console.log(`Deep: Finished updating token '${tokenId}' from '${tokenOldTranslation}' to '${tokenNewTranslation}'`);

                          // finished
                          childCallback();
                        })
                        .catch(childCallback);
                    });
                  })(
                    langTokensMap[languageId][langToken]._id,
                    langTokensMap[languageId][langToken].translation,
                    translation
                  );
                }
              });
            }
          });
        });
      }

      // execute token update operations
      if (tokenUpdateJobs.length > 0) {
        async.parallelLimit(tokenUpdateJobs, 10, function (error) {
          // an error occurred
          if (error) {
            return cb(error);
          }

          // finished - go to next page
          console.log('Updated language tokens');
          cb();
        });
      } else {
        // next page
        console.log('Nothing to change');

        // finished
        cb();
      }
    })
    .catch(cb);
};

module.exports = (methodRelevantArgs) => {
  // keep arguments
  module.methodRelevantArgs = methodRelevantArgs;

  // finished
  return run;
};

