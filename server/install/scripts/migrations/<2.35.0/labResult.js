'use strict';

const app = require('../../../../server');
const _ = require('lodash');
const helpers = require('../../../../../components/helpers');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
let options = {
  _init: true,
  _sync: true
};

/**
 * Migrate lab results
 * @param next
 */
const migrateLabResults = (next) => {
  // retrieve outbreaks data so we can migrate questionnaires accordingly to outbreak template definition
  app.models.outbreak
    .find({}, {
      projection: {
        _id: 1,
        labResultsTemplate: 1
      }
    })
    .then((outbreakData) => {
      // map outbreak data
      const outbreakTemplates = _.transform(
        outbreakData,
        (a, m) => {
          a[m.id] = m.labResultsTemplate;
        },
        {}
      );

      // migrate dates & numbers
      helpers.migrateModelDataInBatches(app.models.labResult, (modelData, cb) => {
        // force lab result save
        const saveLabResult = () => {
          modelData
            .updateAttributes({
              outbreakId: modelData.outbreakId
            }, options)
            .then(() => cb())
            .catch(cb);
        };

        // personType is set when saving the lab-result, so it doesn't matter how we trigger the save
        if (!_.isEmpty(modelData.questionnaireAnswers)) {
          // convert dates
          const questionnaireAnswersClone = _.cloneDeep(modelData.questionnaireAnswers);
          helpers
            .convertQuestionStringDatesToDates(
              modelData,
              outbreakTemplates[modelData.outbreakId]
            )
            .then(() => {
              // check if we have something to change
              if (_.isEqual(modelData.questionnaireAnswers, questionnaireAnswersClone)) {
                // do we need to save personType ?
                if (
                  !modelData.personType &&
                  modelData.personId
                ) {
                  // force lab result save
                  saveLabResult();
                } else {
                  // nothing to change
                  cb();
                }
              } else {
                // migrate
                modelData
                  .updateAttributes({
                    questionnaireAnswers: modelData.questionnaireAnswers
                  }, options)
                  .then(() => cb())
                  .catch(cb);
              }
            })
            .catch(cb);
        } else if (
          !modelData.personType &&
          modelData.personId
        ) {
          // force lab result save
          saveLabResult();
        } else {
          // nothing to do
          cb();
        }
      })
        .then(() => next())
        .catch(next);
    })
    .catch(next);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  migrateLabResults
};
