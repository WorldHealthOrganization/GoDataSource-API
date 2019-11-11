'use strict';

module.exports = function (Event) {
  // set flag to not get controller
  Event.hasController = false;

  Event.fieldLabelsMap = {
    'type': 'LNG_ENTITY_FIELD_LABEL_TYPE',
    'name': 'LNG_EVENT_FIELD_LABEL_NAME',
    'date': 'LNG_EVENT_FIELD_LABEL_DATE',
    'dateOfReporting': 'LNG_EVENT_FIELD_LABEL_DATE_OF_REPORTING',
    'isDateOfReportingApproximate': 'LNG_EVENT_FIELD_LABEL_DATE_OF_REPORTING_APPROXIMATE',
    'description': 'LNG_EVENT_FIELD_LABEL_DESCRIPTION',
    'address': 'LNG_EVENT_FIELD_LABEL_ADDRESS',
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'address.country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'address.city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'address.addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'address.addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'address.postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'address.locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'address.geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'address.geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'address.geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'address.geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'address.phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
  };

  Event.dateFields = [
    'address.date',
    'date',
    'dateOfReporting'
  ];

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Event.nestedGeoPoints = [
    'address.geoLocation'
  ];

  Event.locationFields = [
    'address.locationId'
  ];

  Event.printFieldsinOrder = [
    'type',
    'name',
    'dateOfReporting',
    'isDateOfReportingApproximate',
    'description',
    'address'
  ];

  Event.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    'address.typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
  };

  Event.referenceDataFields = Object.keys(Event.referenceDataFieldsToCategoryMap);
};
