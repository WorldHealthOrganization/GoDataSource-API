'use strict';

const importableFileHelpers = require('./../importableFile');
const helpers = require('./../helpers');

console.log('in process');

const importCases = function () {
  let count = 0;
  process.send({
    childStarted: true,
    childCount: count
  });
  process.on('message', function (message) {
    console.log('child ' + JSON.stringify(message));
    count++;

    process.send({childCount: count});
  });

  const self = this;
  // treat the sync as a regular operation, not really a sync
  options._sync = false;
  // inject platform identifier
  options.platform = Platform.IMPORT;
  // get importable file
  importableFileHelpers
    .getTemporaryFileById(body.fileId)
    .then(file => {
      // get file content
      const rawCasesList = file.data;
      // remap properties & values
      const casesList = helpers.convertBooleanProperties(
        app.models.case,
        helpers.remapProperties(rawCasesList, body.map, body.valuesMap));
      // build a list of create operations
      const createCases = [];
      // define a container for error results
      const createErrors = [];
      // define a toString function to be used by error handler
      createErrors.toString = function () {
        return JSON.stringify(this);
      };
      // go through all entries
      casesList.forEach(function (caseData, index) {
        createCases.push(function (callback) {
          // set outbreak id
          caseData.outbreakId = self.id;

          // filter out empty addresses
          const addresses = app.models.person.sanitizeAddresses(caseData);
          if (addresses) {
            caseData.addresses = addresses;
          }

          // sanitize questionnaire answers
          if (caseData.questionnaireAnswers) {
            // convert properties that should be date to actual date objects
            caseData.questionnaireAnswers = genericHelpers.convertQuestionnairePropsToDate(caseData.questionnaireAnswers);
          }

          // sanitize visual ID
          if (caseData.visualId) {
            caseData.visualId = app.models.person.sanitizeVisualId(caseData.visualId);
          }

          // sync the case
          return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.case, caseData, options)
            .then(function (result) {
              callback(null, result.record);
            })
            .catch(function (error) {
              // on error, store the error, but don't stop, continue with other items
              createErrors.push({
                message: `Failed to import case ${index + 1}`,
                error: error,
                recordNo: index + 1,
                data: {
                  file: rawCasesList[index],
                  save: caseData
                }
              });
              callback(null, null);
            });
        });
      });
      // start importing cases
      async.series(createCases, function (error, results) {
        // handle errors (should not be any)
        if (error) {
          return callback(error);
        }
        // if import errors were found
        if (createErrors.length) {
          // remove results that failed to be added
          results = results.filter(result => result !== null);
          // define a toString function to be used by error handler
          results.toString = function () {
            return JSON.stringify(this);
          };
          // return error with partial success
          return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
            model: app.models.case.modelName,
            failed: createErrors,
            success: results
          }));
        }
        // send the result
        callback(null, results);
      });
    })
    .catch(callback);
};

importCases();

process.on('exit', () => {
  console.log('child exit');
});
