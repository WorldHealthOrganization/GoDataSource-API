'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');

module.exports = function (LabResult) {
  // set flag to not get controller
  LabResult.hasController = false;

  LabResult.fieldLabelsMap = Object.assign({}, LabResult.fieldLabelsMap, {
    personId: 'LNG_LAB_RESULT_FIELD_LABEL_PERSON_ID',
    dateSampleTaken: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_TAKEN',
    dateSampleDelivered: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_DELIVERED',
    dateTesting: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_TESTING',
    dateOfResult: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_OF_RESULT',
    labName: 'LNG_LAB_RESULT_FIELD_LABEL_LAB_NAME',
    sampleIdentifier: 'LNG_LAB_RESULT_FIELD_LABEL_SAMPLE_LAB_ID',
    sampleType: 'LNG_LAB_RESULT_FIELD_LABEL_SAMPLE_TYPE',
    testType: 'LNG_LAB_RESULT_FIELD_LABEL_TEST_TYPE',
    testedFor: 'LNG_LAB_RESULT_FIELD_LABEL_TESTED_FOR',
    result: 'LNG_LAB_RESULT_FIELD_LABEL_RESULT',
    quantitativeResult: 'LNG_LAB_RESULT_FIELD_LABEL_QUANTITATIVE_RESULT',
    notes: 'LNG_LAB_RESULT_FIELD_LABEL_NOTES',
    status: 'LNG_LAB_RESULT_FIELD_LABEL_STATUS',
    questionnaireAnswers: 'LNG_LAB_RESULT_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  });

  LabResult.referenceDataFieldsToCategoryMap = {
    labName: 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
    sampleType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
    testType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
    result: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
    status: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS'
  };

  LabResult.referenceDataFields = Object.keys(LabResult.referenceDataFieldsToCategoryMap);

  LabResult.printFieldsinOrder = [
    'status',
    'labName',
    'testType',
    'testedFor',
    'dateTesting',
    'result',
    'dateOfResult',
    'sampleType',
    'dateSampleTaken',
    'dateSampleDelivered',
    'sampleIdentifier',
    'quantitativeResult',
    'notes'
  ];

  LabResult.extendedForm = {
    template: 'labResultsTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };

  /**
   * Pre-filter lab-results for an outbreak using related models (case)
   * @param outbreak
   * @param filter Supports 'where.case' MongoDB compatible queries
   * @return {Promise<void | never>}
   */
  LabResult.preFilterForOutbreak = function (outbreak, filter) {
    // set a default filter
    filter = filter || {};
    let contactQuery = _.get(filter, 'where.contact');
    if (contactQuery) {
      delete filter.where.contact;
    }
    // get case query, if any
    let caseQuery = _.get(filter, 'where.case');
    // if found, remove it form main query
    if (caseQuery) {
      delete filter.where.case;
    }
    // get main lab results query
    let labResultsQuery = _.get(filter, 'where', {});
    // start with a resolved promise (so we can link others)
    let buildQuery = Promise.resolve();

    const personIds = [];

    // if a case query is present
    if (caseQuery) {
      // restrict query to current outbreak
      caseQuery = {
        $and: [
          caseQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter cases based on query
      buildQuery = buildQuery
        .then(function () {
          return app.models.case
            .rawFind(caseQuery, {projection: {_id: 1}})
            .then(function (cases) {
              // build a list of case ids that passed the filter
              personIds.push(...cases.map(caseRecord => caseRecord.id));
            });
        });
    }
    // if a contact query is present
    if (contactQuery) {
      // restrict query to current outbreak
      contactQuery = {
        $and: [
          contactQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter cases based on query
      buildQuery = buildQuery
        .then(function () {
          return app.models.contact
            .rawFind(contactQuery, {projection: {_id: 1}})
            .then(function (contacts) {
              // build a list of case ids that passed the filter
              personIds.push(...contacts.map(contact => contact.id));
            });
        });
    }

    return buildQuery
      .then(() => {
        // if person ids filter present
        if (personIds.length) {
          // update lab results query to filter based on caseIds
          labResultsQuery = {
            $and: [
              labResultsQuery,
              {
                personId: {
                  $in: personIds
                }
              }
            ]
          };
        }
        // restrict lab results query to current outbreak
        labResultsQuery = {
          $and: [
            labResultsQuery,
            {
              outbreakId: outbreak.id
            }
          ]
        };
        // return updated filter
        return Object.assign(filter, app.utils.remote.convertLoopbackFilterToMongo({where: labResultsQuery}));
      });
  };

  /**
   * Aggregate fiind lab-results
   * @param outbreakId
   * @param filter
   * @param countOnly
   * @param callback
   */
  LabResult.retrieveAggregateLabResults = (
    outbreakId,
    filter,
    countOnly,
    callback
  ) => {
    // make sure we have a default filter
    filter = filter || {};

    // retrieve records from this outbreak
    const outbreakCondition = {
      outbreakId: outbreakId
    };
    filter.where = _.isEmpty(filter.where) ?
      outbreakCondition : {
        and: [
          outbreakCondition,
          filter.where
        ]
      };

    // filter lab results
    app.models.labResult
      .rawFindAggregate(
        filter, {
          countOnly: countOnly,
          relations: [{
            lookup: {
              from: 'person',
              localField: 'personId',
              foreignField: '_id',
              as: 'person'
            },
            unwind: true,
            map: (record) => {
              // replace id
              record.id = record._id;
              delete record._id;

              // finished
              return record;
            }
          }]
        }
      )
      .then((labResults) => {
        callback(null, labResults);
      })
      .catch(callback);
  };

  /**
   * Before save hooks
   */
  LabResult.observe('before save', function (context, next) {
    // sort multi answer questions
    const data = context.isNewInstance ? context.instance : context.data;
    helpers.sortMultiAnswerQuestions(data);

    const promiseChain = Promise.resolve();
    promiseChain
      .then(() => {
        const instanceData = context.isNewInstance ? context.instance : context.currentInstance;

        // add the custom helper property person type
        // mainly used for filtering lab results based on the type
        if (
          !instanceData.personType &&
          instanceData.personId
        ) {
          return app.models.person
            .findOne({
              deleted: true,
              where: {
                id: instanceData.personId
              }
            })
            .then((person) => {
              data.personType = person ? person.type : undefined;
            });
        }

        // we can't or don't need to update personType
        return null;
      })
      .then(() => {
        // retrieve outbreak data
        let model = _.get(context, 'options.remotingContext.instance');
        if (model) {
          if (!(model instanceof app.models.outbreak)) {
            model = undefined;
          }
        }

        // convert date fields to date before saving them in database
        helpers
          .convertQuestionStringDatesToDates(
            data,
            model ?
              model.labResultsTemplate :
              null
          )
          .then(() => {
            // finished
            next();
          })
          .catch(next);
      });
  });

  /**
   * Migrate lab results
   * @param options
   * @param next
   */
  LabResult.migrate = (options, next) => {
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
        helpers.migrateModelDataInBatches(LabResult, (modelData, cb) => {
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
};
