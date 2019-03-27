'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');

module.exports = function (LabResult) {
  // set flag to not get controller
  LabResult.hasController = false;

  LabResult.fieldLabelsMap = Object.assign({}, LabResult.fieldLabelsMap, {
    personId: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_PERSON_ID',
    dateSampleTaken: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_TAKEN',
    dateSampleDelivered: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_DELIVERED',
    dateTesting: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_TESTING',
    dateOfResult: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_DATE_OF_RESULT',
    labName: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_LAB_NAME',
    sampleIdentifier: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_ID',
    sampleType: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_SAMPLE_TYPE',
    testType: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_TEST_TYPE',
    result: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_RESULT',
    quantitativeResult: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_QUANTITATIVE_RESULT',
    notes: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_NOTES',
    status: 'LNG_CASE_LAB_RESULT_FIELD_LABEL_STATUS'
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
    containerProperty: 'questionnaireAnswers'
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
              return cases.map(caseRecord => caseRecord.id);
            });
        });
    }
    return buildQuery
      .then(function (caseIds) {
        // if caseIds filter present
        if (caseIds) {
          // update lab results query to filter based on caseIds
          labResultsQuery = {
            $and: [
              labResultsQuery,
              {
                personId: {
                  $in: caseIds
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
        return Object.assign(filter, {where: labResultsQuery});
      });
  };

  /**
   * Before save hooks
   */
  LabResult.observe('before save', function (context, next) {
    helpers.sortMultiAnswerQuestions(context.isNewInstance ? context.instance : context.data);
    next();
  });
};
