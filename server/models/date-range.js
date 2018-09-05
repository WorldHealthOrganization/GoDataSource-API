'use strict';

module.exports = function (DateRange) {

  DateRange.fieldLabelsMap = {
    'startDate': 'LNG_OUTBREAK_FIELD_LABEL_START_DATE',
    'endDate': 'LNG_OUTBREAK_FIELD_LABEL_END_DATE'
  };

  DateRange.printFieldsinOrder = [
    'startDate',
    'endDate'
  ];
};
