'use strict';

module.exports = function(Address) {
  // map language token labels for model properties
  Address.fieldLabelsMap = {
    'name': 'LNG_ADDRESS_FIELD_LABEL_NAME',
    'country': 'LNG_ADDRESS_FIELD_LABEL_COUNTRY',
    'city': 'LNG_ADDRESS_FIELD_LABEL_CITY',
    'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LINE_1',
    'addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LINE_2',
    'postalCode': 'LNG_ADDRESS_FIELD_LABEL_POSTAL_CODE',
    'locationId': 'LNG_ADDRESS_FIELD_LABEL_LOCATION',
    'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_GEOLOCATION',
    'date': 'LNG_ADDRESS_FIELD_LABEL_DATE'
  };

  Address.printFieldsinOrder = [
    'name',
    'country',
    'city',
    'addressLine1',
    'addressLine2',
    'postalCode',
    'locationId',
    'geoLocation',
    'date'
  ]
};
