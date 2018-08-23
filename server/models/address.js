'use strict';

module.exports = function (Address) {

  // map language token labels for model properties
  Address.fieldLabelsMap = {
    'typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE'
  };


  /**
   * Workaround for a loopbpack/mongo issue:
   * Loopback sends all model properties (at least those that have sub-definitions) without values, to Mongo, as undefined. Mongo converts undefined in null
   * There's a property (ignoreUndefined) for MongoDB driver, that will solve the issue, however the property is not sent
   * in 'findAndModify' function. Saving indexed Geolocations in MongoDB with null values results in 'Can't extract geoKeys' error
   * To work around this issue, we remove geoLocation property definition from address, this way loopback won't send default values
   * but the property will still remain in the documentation
   */
  Address.removePropertiesFromDefinion = [
    'id',
    'geoLocation'
  ];
};
