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

  // this is solely used for attaching parent locations custom fields in prints
  DateRange.locationsFieldsMap = {
    locationId: 'LNG_CASE_FIELD_LABEL_DATE_RANGE_LOCATION'
  };
};
