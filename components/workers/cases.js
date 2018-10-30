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
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

