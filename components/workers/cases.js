'use strict';

const _ = require('lodash');
const helpers = require('../helpers');

/**
 * Count category over time
 * @param cases
 * @param periodInterval
 * @param periodType
 * @param periodMap
 * @param timePropertyName
 * @param exportedPropertyName
 * @param categoryPropertyName
 * @param categoryList
 * @returns {*}
 */
function countCategoryOverTime(cases, periodInterval, periodType, periodMap, timePropertyName, exportedPropertyName, categoryPropertyName, categoryList) {
  // go through all the cases
  cases.forEach(function (caseRecord) {
    // get interval based on date of onset
    const caseOnsetInterval = helpers.getPeriodIntervalForDate(periodInterval, periodType, _.get(caseRecord, timePropertyName));
    // build period map index for onset interval
    const periodMapIndex = `${caseOnsetInterval[0]} - ${caseOnsetInterval[1]}`;
    // if an index was found outside built periodMap (this usually happens when dateOfOnset is before outbreak startDate)
    if (!periodMap[periodMapIndex]) {
      // init periodMap entry
      periodMap[periodMapIndex] = {
        start: caseOnsetInterval[0],
        end: caseOnsetInterval[1],
        [exportedPropertyName]: Object.assign({}, categoryList),
        total: 0
      };
    }
    // check if the classification exists on the interval
    if (!periodMap[periodMapIndex][exportedPropertyName][caseRecord[categoryPropertyName]]) {
      // if it does not, add it
      periodMap[periodMapIndex][exportedPropertyName][caseRecord[categoryPropertyName]] = 0;
    }
    // increment classification counter for period
    periodMap[periodMapIndex][exportedPropertyName][caseRecord[categoryPropertyName]]++;
    // increment total counter per period
    periodMap[periodMapIndex].total++;
  });
  return periodMap;
}


const worker = {
  /**
   * Count cases stratified by classification over time
   * @param cases
   * @param periodInterval
   * @param periodType
   * @param periodMap
   * @param caseClassifications
   * @return {*}
   */
  countStratifiedByClassificationOverTime: function (cases, periodInterval, periodType, periodMap, caseClassifications) {
    return countCategoryOverTime(
      cases,
      periodInterval,
      periodType,
      periodMap,
      'dateOfOnset',
      'classification',
      'classification',
      caseClassifications
    );
  },
  /**
   * Count cases stratified by outcome over time
   * @param cases
   * @param periodInterval
   * @param periodType
   * @param periodMap
   * @param caseOutcomeList
   * @return {*}
   */
  countStratifiedByOutcomeOverTime: function (cases, periodInterval, periodType, periodMap, caseOutcomeList) {
    return countCategoryOverTime(
      cases,
      periodInterval,
      periodType,
      periodMap,
      'dateOfOutcome',
      'outcome',
      'outcomeId',
      caseOutcomeList
    );
  },
  /**
   * Count cases stratified by classification over reporting time
   * @param cases
   * @param periodInterval
   * @param periodType
   * @param periodMap
   * @param caseClassifications
   * @return {*}
   */
  countStratifiedByClassificationOverReportingTime: function (cases, periodInterval, periodType, periodMap, caseClassifications) {
    return countCategoryOverTime(
      cases,
      periodInterval,
      periodType,
      periodMap,
      'dateOfReporting',
      'classification',
      'classification',
      caseClassifications
    );
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

