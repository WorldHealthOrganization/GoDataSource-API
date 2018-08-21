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
    'fillGeolocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'questionnaireAnswers': 'LNG_PAGE_CREATE_FOLLOW_UP_TAB_QUESTIONNAIRE_TITLE',
    'index': 'LNG_FOLLOW_UP_FIELD_LABEL_INDEX',
    'teamId': 'LNG_FOLLOW_UP_FIELD_LABEL_TEAM',
    'isGenerated': 'LNG_FOLLOW_UP_FIELD_LABEL_IS_GENERATED'
  };

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Followup.nestedGeoPoints = [
    'address.geoLocation'
  ];

  /**
   * Enhance follow up save to include index of the created follow up
   */
  Followup.observe('before save', function (ctx, next) {
    // we are interested only on new instances
    if (!ctx.isNewInstance) {
      return next();
    }

    //Find the oldest existing followUp of the contact
    app.models.followUp.findOne({
      where: {
        personId: ctx.instance.personId
      },
      order: 'date ASC'
    })
    .then((followUp) => {
      //If it is in the past, use it as a starting point for the index calculation
      if(followUp && daysSince(followUp.date, Date.now()) >= 0) {
        ctx.instance.index = daysSince(followUp.date, ctx.instance.date) + 1;
      } else {
        //If no followUp exists in the past, initiate a new index
        //If the followUp is part of a followUp generate action, use now() to calculate the index
        if(ctx.instance.isGenerated) {
          ctx.instance.index = daysSince(Date.now(), ctx.instance.date) + 1;
        } else {
          //If this is the first follow up and it is added separately (create followUp) set the index to 1.
          ctx.instance.index = 1;
        }
      }

      return next();
    })
    .catch((next));
  });

  /**
   *
   * @param startDate
   * @param endDate
   */
  const daysSince = function (startDate, endDate){
    return (moment(endDate).startOf('day')).diff(moment(startDate).startOf('day'), 'days');
  };
};
