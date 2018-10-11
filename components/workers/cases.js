'use strict';

const helpers = require('../helpers');

const worker = {
  /**
   * Count cases stratified by classification over time
   * @param cases
   * @param periodInterval
   * @param periodType
   * @param periodMap
   * @return {*}
   */
  countStratifiedByClassificationOverTime: function (cases, periodInterval, periodType, periodMap) {
    // go through all the cases
    cases.forEach(function (caseRecord) {
      // keep a map of case classification history
      const caseRecordClassificationHistoryMap = {};
      // go through all case classifications
      Array.isArray(caseRecord.classificationHistory) && caseRecord.classificationHistory
        .forEach(function (classificationHistoryEntry) {
          // make sure they all have end dates
          if (!classificationHistoryEntry.endDate) {
            classificationHistoryEntry.endDate = new Date();
          }
          // build a classification history map for each classification history entry
          const classificationHistoryEntryMap = helpers.getChunksForInterval([
            classificationHistoryEntry.startDate,
            classificationHistoryEntry.endDate
          ], periodType);

          // go through the build history map
          Object.keys(classificationHistoryEntryMap).forEach(function (index) {
            // get correct start/end dates for period type
            const start = helpers.getPeriodIntervalForDate(periodInterval, periodType, classificationHistoryEntryMap[index].start).shift();
            const end = helpers.getPeriodIntervalForDate(periodInterval, periodType, classificationHistoryEntryMap[index].end).pop();
            // add (indexed by period type) for case classification
            caseRecordClassificationHistoryMap[`${start} - ${end}`] = classificationHistoryEntry.classification;
          });
        });
      // go through the case classification history map
      Object.keys(caseRecordClassificationHistoryMap)
        .forEach(function (index) {
          // if the period map entry is missing, add it
          if (!periodMap[index]) {
            periodMap[index] = {
              classification: {},
              total: 0
            };
          }
          // if the period map classification entry is missing, add it
          if (!periodMap[index].classification[caseRecordClassificationHistoryMap[index]]) {
            periodMap[index].classification[caseRecordClassificationHistoryMap[index]] = 0;
          }
          // increment classification counter for period
          periodMap[index].classification[caseRecordClassificationHistoryMap[index]]++;
          // increment total counter per period
          periodMap[index].total++;
        });
    });
    return periodMap;
  }
};

process.on('message', function (message) {
  let result = worker[message.fn](...message.args);
  process.send([null, result]);
});

