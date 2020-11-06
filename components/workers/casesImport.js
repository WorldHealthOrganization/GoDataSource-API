'use strict';

const importableFileHelpers = require('./../importableFile');
const helpers = require('./../helpers');
const async = require('async');

/**
 * Send message to parent
 * @param message
 */
const sendMessageToParent = function (message) {
  process.send([null, message]);
};

/**
 * Send error message to parent
 * @param error
 */
const sendErrorToParent = function (error) {
  process.send([error instanceof Error ? {
    message: error.message,
    stack: error.stack
  } : error]);
};

/**
 * Read from file and format case data
 */
const readAndFormatCases = function () {
  // initialize cache for processed data
  const casesToSend = [];

  // initialize variable to cache batch size
  let batchSize;

  // initialize variable to know when all data has been processed
  let allDataProcessed = false;

  // handle messages from parent process
  process.on('message', function (message) {
    // depending on message we need to make different actions
    switch (message.subject) {
      case 'start': {
        // get options
        const options = message.options;

        // cache batch size
        batchSize = options.batchSize;

        // get importable file
        importableFileHelpers
          .getTemporaryFileById(options.fileId)
          .then(file => {
            // get file content
            const rawCasesList = file.data;

            // send message to parent to know that processing has started
            sendMessageToParent({
              subject: 'start',
              // send total number of cases to import
              totalCasesNo: rawCasesList.length
            });

            // remap properties & values
            const casesList = helpers.convertBooleanPropertiesNoModel(
              options.modelBooleanProperties || [],
              helpers.remapProperties(rawCasesList, options.map, options.valuesMap));

            sendMessageToParent({
              subject: 'log',
              log: 'Finished boolean properties conversion'
            });

            async.eachOfSeries(
              casesList,
              (formattedData, index, callback) => {
                // set outbreak id
                formattedData.outbreakId = options.outbreakId;

                // filter out empty addresses
                const addresses = helpers.sanitizePersonAddresses(formattedData);
                if (addresses) {
                  formattedData.addresses = addresses;
                }

                // sanitize questionnaire answers
                if (formattedData.questionnaireAnswers) {
                  // convert properties that should be date to actual date objects
                  formattedData.questionnaireAnswers = helpers.convertQuestionnairePropsToDate(formattedData.questionnaireAnswers);
                }

                // sanitize visual ID
                if (formattedData.visualId) {
                  formattedData.visualId = helpers.sanitizePersonVisualId(formattedData.visualId);
                }

                // add case entry in the list to be sent to parent
                casesToSend.push({
                  raw: rawCasesList[index],
                  save: formattedData
                });

                sendMessageToParent({
                  subject: 'log',
                  log: 'Pushed case ' + index
                });

                callback();
              },
              () => {
                allDataProcessed = true;
                sendMessageToParent({
                  subject: 'log',
                  log: 'All data was processed'
                });
              });
            // go through all entries
            // casesList.forEach(function (formattedData, index) {
            //   // set outbreak id
            //   formattedData.outbreakId = options.outbreakId;
            //
            //   // filter out empty addresses
            //   const addresses = helpers.sanitizePersonAddresses(formattedData);
            //   if (addresses) {
            //     formattedData.addresses = addresses;
            //   }
            //
            //   // sanitize questionnaire answers
            //   if (formattedData.questionnaireAnswers) {
            //     // convert properties that should be date to actual date objects
            //     formattedData.questionnaireAnswers = helpers.convertQuestionnairePropsToDate(formattedData.questionnaireAnswers);
            //   }
            //
            //   // sanitize visual ID
            //   if (formattedData.visualId) {
            //     formattedData.visualId = helpers.sanitizePersonVisualId(formattedData.visualId);
            //   }
            //
            //   // add case entry in the list to be sent to parent
            //   casesToSend.push({
            //     raw: rawCasesList[index],
            //     save: formattedData
            //   });
            // });
            //
            // allDataProcessed = true;
          })
          .catch(sendErrorToParent);

        break;
      }
      case 'nextBatch': {
        sendMessageToParent({
          subject: 'nextBatch',
          // send cases for this batch; max batchSize items will be send
          data: casesToSend.splice(0, batchSize)
        });

        if (allDataProcessed && !casesToSend.length) {
          sendMessageToParent({
            subject: 'finished'
          });
        }

        break;
      }
      default:
        // unhandled subject
        sendErrorToParent(new Error(`Worker received an invalid message subject '${message.subject}'`));
        break;
    }
  });
};

readAndFormatCases();
