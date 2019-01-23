'use strict';

const helpers = require('../helpers');

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
    // go through all the cases
    cases.forEach(function (caseRecord) {
      // get interval based on date of onset
      const caseOnsetInterval = helpers.getPeriodIntervalForDate(periodInterval, periodType, caseRecord.dateOfOnset);
      // build period map index for onset interval
      const periodMapIndex = `${caseOnsetInterval[0]} - ${caseOnsetInterval[1]}`;
      // if an index was found outside built periodMap (this usually happens when dateOfOnset is before outbreak startDate)
      if (!periodMap[periodMapIndex]) {
        // init periodMap entry
        periodMap[periodMapIndex] = {
          start: caseOnsetInterval[0],
          end: caseOnsetInterval[1],
          classification: Object.assign({}, caseClassifications),
          total: 0
        };
      }
      // check if the classification exists on the interval
      if (!periodMap[periodMapIndex].classification[caseRecord.classification]) {
        // if it does not, add it
        periodMap[periodMapIndex].classification[caseRecord.classification] = 0;
      }
      // increment classification counter for period
      periodMap[periodMapIndex].classification[caseRecord.classification]++;
      // increment total counter per period
      periodMap[periodMapIndex].total++;
    });
    return periodMap;
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
    // go through all the cases
    cases.forEach(function (caseRecord) {
      // get interval based on date of outcome
      const caseOutcomeInterval = helpers.getPeriodIntervalForDate(periodInterval, periodType, caseRecord.dateOfOutcome);
      // build period map index for outcome interval
      const periodMapIndex = `${caseOutcomeInterval[0]} - ${caseOutcomeInterval[1]}`;
      // if an index was found outside built periodMap (this usually happens when outcome is before outbreak startDate)
      if (!periodMap[periodMapIndex]) {
        // init periodMap entry
        periodMap[periodMapIndex] = {
          start: caseOutcomeInterval[0],
          end: caseOutcomeInterval[1],
          outcome: Object.assign({}, caseOutcomeList),
          total: 0
        };
      }
      // check if the outcome exists on the interval
      if (!periodMap[periodMapIndex].outcome[caseRecord.outcomeId]) {
        // if it does not, add it
        periodMap[periodMapIndex].outcome[caseRecord.outcomeId] = 0;
      }
      // increment outcome counter for period
      periodMap[periodMapIndex].outcome[caseRecord.outcomeId]++;
      // increment total counter per period
      periodMap[periodMapIndex].total++;
    });
    return periodMap;
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
    // go through all the cases
    cases.forEach(function (caseRecord) {
      // get interval based on date of onset
      const caseReportingInterval = helpers.getPeriodIntervalForDate(periodInterval, periodType, caseRecord.dateOfReporting);
      // build period map index for onset interval
      const periodMapIndex = `${caseReportingInterval[0]} - ${caseReportingInterval[1]}`;
      // if an index was found outside built periodMap (this usually happens when dateOfOnset is before outbreak startDate)
      if (!periodMap[periodMapIndex]) {
        // init periodMap entry
        periodMap[periodMapIndex] = {
          start: caseReportingInterval[0],
          end: caseReportingInterval[1],
          classification: Object.assign({}, caseClassifications),
          total: 0
        };
      }
      // check if the classification exists on the interval
      if (!periodMap[periodMapIndex].classification[caseRecord.classification]) {
        // if it does not, add it
        periodMap[periodMapIndex].classification[caseRecord.classification] = 0;
      }
      // increment classification counter for period
      periodMap[periodMapIndex].classification[caseRecord.classification]++;
      // increment total counter per period
      periodMap[periodMapIndex].total++;
    });
    return periodMap;
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

