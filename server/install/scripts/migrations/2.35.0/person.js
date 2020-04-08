'use strict';

/**
 * Set hasRelationships flag as true on all persons which have relationships
 * @param next
 */
const setHasRelationshipsFlag = (next) => {
  // retrieve outbreaks data so we can migrate questionnaires accordingly to outbreak template definitiuon
  app.models.outbreak
    .find({}, {
      projection: {
        _id: 1,
        caseInvestigationTemplate: 1
      }
    })
    .then((outbreakData) => {
      // map outbreak data
      const outbreakTemplates = _.transform(
        outbreakData,
        (a, m) => {
          a[m.id] = m.caseInvestigationTemplate;
        },
        {}
      );

      // migrate dates & numbers
      helpers.migrateModelDataInBatches(app.models.case, (modelData, cb) => {
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
                // nothing to change
                cb();
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
  setHasRelationshipsFlag
};
