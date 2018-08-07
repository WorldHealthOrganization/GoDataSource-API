'use strict';

module.exports = function(Address) {
  // map language token labels for model properties
  Address.fieldLabelsMap = {
    'name': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_NAME',
    'country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE'
  };
};
