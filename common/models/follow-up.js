'use strict';

const app = require('../../server/server');
const moment = require('moment');

module.exports = function (Followup) {
  // set flag to not get controller
  Followup.hasController = false;

  // map language token labels for model properties
  Followup.fieldLabelsMap = {
    'date': 'LNG_FOLLOW_UP_FIELD_LABEL_DATE',
    'performed': 'LNG_FOLLOW_UP_FIELD_LABEL_PERFORMED',
    'lostToFollowUp': 'LNG_FOLLOW_UP_FIELD_LABEL_LOST_TO_FOLLOW_UP',
    'address': 'LNG_FOLLOW_UP_FIELD_LABEL_ADDRESS',
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'address.country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'address.city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'address.addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'address.addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'address.postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'address.locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'address.geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'address.geoLocation.lat': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_LAT',
    'address.geoLocation.lng': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_LNG',
    'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'fillGeolocation': 'LNG_FOLLOW_UP_FIELD_LABEL_FILL_GEO_LOCATION',
    'fillGeolocation.lat': 'LNG_FOLLOW_UP_FIELD_LABEL_FILL_GEO_LOCATION_LAT',
    'fillGeolocation.lng': 'LNG_FOLLOW_UP_FIELD_LABEL_FILL_GEO_LOCATION_LNG',
    'questionnaireAnswers': 'LNG_PAGE_CREATE_FOLLOW_UP_TAB_QUESTIONNAIRE_TITLE',
    'index': 'LNG_FOLLOW_UP_FIELD_LABEL_INDEX',
    'teamId': 'LNG_FOLLOW_UP_FIELD_LABEL_TEAM',
    'isGenerated': 'LNG_FOLLOW_UP_FIELD_LABEL_IS_GENERATED'
  };

  Followup.referenceDataFieldsToCategoryMap = {
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPE'
  };

  Followup.referenceDataFields = Object.keys(Followup.referenceDataFieldsToCategoryMap);

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Followup.nestedGeoPoints = [
    'address.geoLocation'
  ];

  Followup.printFieldsinOrder = [
    'date',
    'performed',
    'lostToFollowUp',
    'address',
    'index',
    'teamId'
  ];

  Followup.locationFields = [
    'address.locationId'
  ];

  Followup.foreignKeyResolverMap = {
    'address.locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'teamId': {
      modelName: 'team',
      useProperty: 'name'
    }
  };

  Followup.extendedForm = {
    template: 'contactFollowUpTemplate',
    containerProperty: 'questionnaireAnswers'
  };

  /**
   * Enhance follow up save to include index of the created follow up
   */
  Followup.observe('before save', function (ctx, next) {
    // we are interested only on new instances
    if (!ctx.isNewInstance) {
      return next();
    }

    // retrieve the owner of the follow up to fetch followup original date
    app.models.person
      .findById(ctx.instance.personId)
      .then((person) => {
        // if follow up is not within configured start/end dates throw error
        let startDate = moment(person.followUp.originalStartDate);
        let endDate = moment(person.followUp.endDate);
        if (!moment(ctx.instance.date).startOf('day').isBetween(startDate, endDate, 'day', '[]')) {
          return next(app.utils.apiError.getError('INVALID_FOLLOW_UP_DATE'));
        }

        // set index based on the difference in days from start date until the follow up set date
        // index is incremented by 1 because if follow up is on exact start day, the counter starts with 0
        ctx.instance.index = daysSince(person.followUp.originalStartDate, ctx.instance.date) + 1;

        return next();
      })
      .catch(next);
  });

  /**
   *
   * @param startDate
   * @param endDate
   */
  const daysSince = function (startDate, endDate) {
    return (moment(endDate).startOf('day')).diff(moment(startDate).startOf('day'), 'days');
  };
};
