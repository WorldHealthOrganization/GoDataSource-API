'use strict';

module.exports = function (Address) {

  // map language token labels for model properties
  Address.fieldLabelsMap = {
    'typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS'
  };

  Address.referenceDataFields = [
    'typeId'
  ];

  Address.printFieldsinOrder = [
    'typeId',
    'country',
    'city',
    'addressLine1',
    'postalCode',
    'locationId',
    'geoLocation',
    'geoLocationAccurate',
    'date',
    'phoneNumber',
    'emailAddress'
  ];

  // this is solely used for attaching parent locations custom fields in prints
  Address.locationsFieldsMap = {
    locationId: 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID'
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

  Address.getHumanReadableAddress = function (address) {
    let readableAddress = '';

    if (!address) {
      return readableAddress;
    }

    if (address.city) {
      readableAddress += address.city;
    }

    if (address.addressLine1) {
      readableAddress += (readableAddress.length ? `, ${address.addressLine1}` : address.addressLine1);
    }

    return readableAddress;
  };
};
