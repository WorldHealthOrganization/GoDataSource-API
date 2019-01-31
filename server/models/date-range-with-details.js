'use strict';

module.exports = function (DateRange) {

  DateRange.fieldLabelsMap = {
    'startDate': 'LNG_OUTBREAK_FIELD_LABEL_START_DATE',
    'endDate': 'LNG_OUTBREAK_FIELD_LABEL_END_DATE',
    'centerName': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_CENTER_NAME',
    'locationId': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_LOCATION',
    'comments': 'LNG_CASE_FIELD_LABEL_DATE_RANGE_COMMENTS'
  };

  DateRange.printFieldsinOrder = [
    'startDate',
    'endDate',
    'centerName',
    'locationId',
    'comments'
  ];
};