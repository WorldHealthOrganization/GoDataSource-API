'use strict';

module.exports = function (Event) {
  // set flag to not get controller
  Event.hasController = false;

  // important => DON'T use "Event.fieldLabelsMap = Object.assign({}, Event.fieldLabelsMap, {" since it gets all fields from person and we don't want that
  Event.fieldLabelsMap = {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdAt: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT',
    createdOn: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_ON',
    'visualId': 'LNG_EVENT_FIELD_LABEL_VISUAL_ID',
    'type': 'LNG_ENTITY_FIELD_LABEL_TYPE',
    'numberOfExposures': 'LNG_EVENT_FIELD_LABEL_NUMBER_OF_EXPOSURES',
    'numberOfContacts': 'LNG_EVENT_FIELD_LABEL_NUMBER_OF_CONTACTS',
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
    'address.postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'address.locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'address.geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'address.geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'address.geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'address.geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'address.phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'address.emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS',
    'responsibleUserId': 'LNG_EVENT_FIELD_LABEL_RESPONSIBLE_USER_UUID', // required for import map
    'responsibleUser': 'LNG_EVENT_FIELD_LABEL_RESPONSIBLE_USER_ID',
    'responsibleUser.id': 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    'responsibleUser.firstName': 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    'responsibleUser.lastName': 'LNG_USER_FIELD_LABEL_LAST_NAME',
    'eventCategory': 'LNG_EVENT_FIELD_LABEL_EVENT_CATEGORY',
    'endDate': 'LNG_EVENT_FIELD_LABEL_END_DATE'
  };

  // used on importable file logic
  Event.foreignKeyFields = {
    'responsibleUserId': {
      modelName: 'user',
      collectionName: 'user',
      labelProperty: [
        'firstName',
        'lastName',
        'email'
      ]
    }
  };

  // map language token labels for export fields group
  Event.exportFieldsGroup = {
    'LNG_COMMON_LABEL_EXPORT_GROUP_RECORD_CREATION_AND_UPDATE_DATA': {
      properties: [
        'id',
        'createdAt',
        'createdBy',
        'updatedAt',
        'updatedBy',
        'deleted',
        'deletedAt',
        'createdOn'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_CORE_DEMOGRAPHIC_DATA': {
      properties: [
        'visualId',
        'name',
        'type',
        'date',
        'dateOfReporting',
        'isDateOfReportingApproximate',
        'eventCategory',
        'endDate',
        'description',
        'responsibleUser',
        'responsibleUser.id',
        'responsibleUser.firstName',
        'responsibleUser.lastName',
        'numberOfExposures',
        'numberOfContacts'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA': {
      properties: [
        'address',
        'address.typeId',
        'address.country',
        'address.city',
        'address.addressLine1',
        'address.postalCode',
        'address.locationId',
        'address.geoLocation',
        'address.geoLocation.lat',
        'address.geoLocation.lng',
        'address.geoLocationAccurate',
        'address.date',
        'address.phoneNumber',
        'address.emailAddress'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA': {
      properties: [
        // the ids and identifiers fields for a location are added custom
      ],
      required: [
        'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA'
      ]
    }
  };

  // default export order
  Event.exportFieldsOrder = [
    'id',
    'visualId',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ];

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Event.nestedGeoPoints = [
    'address.geoLocation'
  ];

  Event.locationFields = [
    'address.locationId'
  ];

  Event.printFieldsinOrder = [
    'visualId',
    'type',
    'name',
    'date',
    'dateOfReporting',
    'isDateOfReportingApproximate',
    'eventCategory',
    'endDate',
    'description',
    'address'
  ];

  Event.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    'address.typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    eventCategory: 'LNG_REFERENCE_DATA_CATEGORY_EVENT_CATEGORY'
  };

  Event.referenceDataFields = Object.keys(Event.referenceDataFieldsToCategoryMap);

  /**
   * Get alternate unique identifier query for sync/import actions
   * Note: Event records don't have an alternate unique identifier. Overwriting Person model function
   * @returns {null}
   */
  Event.getAlternateUniqueIdentifierQueryForSync = () => {
    return null;
  };
};
