'use strict';

const app = require('../../server/server');
const moment = require('moment');
const _ = require('lodash');

module.exports = function (FollowUp) {
  // set flag to not get controller
  FollowUp.hasController = false;

  // filter for seen follow ups
  FollowUp.seenFilter = {
    or: [
      {
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK'
      },
      {
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK'
      }
    ]
  };

  // filter for not seen follow ups
  FollowUp.notSeenFilter = {
    or: [
      {
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED'
      },
      {
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_MISSED'
      }
    ]
  };

  // helper functions that indicates if a follow up is performed
  FollowUp.isPerformed = function (obj) {
    return [
      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK',
      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK',
      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_MISSED'
    ].indexOf(obj.statusId) >= 0;
  };

  // map language token labels for model properties
  FollowUp.fieldLabelsMap = {
    'date': 'LNG_FOLLOW_UP_FIELD_LABEL_DATE',
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
    'index': 'LNG_FOLLOW_UP_FIELD_LABEL_INDEX',
    'teamId': 'LNG_FOLLOW_UP_FIELD_LABEL_TEAM',
    'statusId': 'LNG_FOLLOW_UP_FIELD_LABEL_STATUSID',
    'isGenerated': 'LNG_FOLLOW_UP_FIELD_LABEL_IS_GENERATED',
    'targeted': 'LNG_FOLLOW_UP_FIELD_LABEL_TARGETED',
    'questionnaireAnswers': 'LNG_PAGE_CREATE_FOLLOW_UP_TAB_QUESTIONNAIRE_TITLE'
  };

  FollowUp.referenceDataFieldsToCategoryMap = {
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPE',
    'statusId': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE'
  };

  FollowUp.referenceDataFields = Object.keys(FollowUp.referenceDataFieldsToCategoryMap);

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  FollowUp.nestedGeoPoints = [
    'address.geoLocation'
  ];

  FollowUp.printFieldsinOrder = [
    'date',
    'statusId',
    'targeted',
    'address',
    'index',
    'teamId'
  ];

  FollowUp.locationFields = [
    'address.locationId'
  ];

  FollowUp.foreignKeyResolverMap = {
    'address.locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'teamId': {
      modelName: 'team',
      useProperty: 'name'
    }
  };

  FollowUp.extendedForm = {
    template: 'contactFollowUpTemplate',
    containerProperty: 'questionnaireAnswers'
  };

  /**
   * Enhance follow up save to include index of the created follow up
   */
  FollowUp.observe('before save', function (ctx, next) {
    // we are interested only on new instances and on actions different than sync
    if (!ctx.isNewInstance || (ctx.options && ctx.options._sync)) {
      return next();
    }

    // retrieve the owner of the follow up to fetch followup original date
    app.models.person
      .findById(ctx.instance.personId)
      .then((person) => {
        // set index based on the difference in days from start date until the follow up set date
        // index is incremented by 1 because if follow up is on exact start day, the counter starts with 0
        ctx.instance.index = daysSince(moment(person.followUp.startDate), ctx.instance.date) + 1;

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

  /**
   * Count contacts on follow-up lists on a specific day (default day: current day)
   * @param outbreakId
   * @param filter Accepts 'date' on the first level of 'where' property
   */
  FollowUp.countContacts = function (outbreakId, filter) {
    // define a date filter
    let dateFilter, endDateFilter;
    // try to get date filter from filters
    if (filter) {
      dateFilter = _.get(filter, 'where.date');
      _.unset(filter, 'where.date');
    }
    // if a filter was passed
    if (dateFilter) {
      // used passed filter
      dateFilter.setHours(0, 0, 0, 0);
    } else {
      // by default, date filter is for today
      dateFilter = new Date();
      dateFilter.setHours(0, 0, 0, 0);
    }
    // update end date filter
    endDateFilter = new Date(dateFilter);
    endDateFilter.setHours(23, 59, 59, 999);

    // get follow-ups
    return FollowUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          // get follow-ups that are scheduled later than today 00:00 hours
          date: {
            between: [
              dateFilter, endDateFilter
            ]
          }
        }
      }, filter || {}))
      .then(function (followUps) {
        // filter by relation properties
        followUps = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followUps, filter);
        // initialize contacts map; helper to not count contacts twice
        let contactsMap = {};

        // loop through the followups to get unique contacts
        followUps.forEach(function (followUp) {
          if (!contactsMap[followUp.personId]) {
            contactsMap[followUp.personId] = true;
          }
        });

        // get contacts IDs
        let contactIDs = Object.keys(contactsMap);

        // create result
        return {
          contactsCount: contactIDs.length,
          followUpsCount: followUps.length,
          contactIDs: contactIDs
        };
      });
  };

  /**
   * Count follow-ups grouped by associated team
   * @param outbreakId
   * @param filter
   */
  FollowUp.countByTeam = function (outbreakId, filter) {
    // find follow-ups for current outbreak
    return FollowUp
      .find(app.utils.remote
        .mergeFilters({
          where: {
            outbreakId: outbreakId
          }
        }, filter || {})
      )
      .then(function (followUps) {
        // filter by relation properties
        followUps = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followUps, filter);
        // define result
        const result = {
          team: {},
          count: followUps.length
        };
        // go through all followUps
        followUps.forEach(function (followUp) {
          // use empty string for not associated team
          if (!followUp.teamId) {
            followUp.teamId = '';
          }
          // init team container if not already inited
          if (!result.team[followUp.teamId]) {
            result.team[followUp.teamId] = {
              followUpIds: [],
              count: 0
            };
          }
          // add follow-up ID per team
          result.team[followUp.teamId].followUpIds.push(followUp.id);
          // increment the number of follow-ups per team
          result.team[followUp.teamId].count++;
        });
        // return built result
        return result;
      });
  };

  // Get contact's whose last follow up was not performed or missing
  // Used mainly for handling a specific case during follow up generation
  FollowUp.getContactsWithLostLastFollowUp = function () {
    return app.models.contact
      .find({
        include: [
          {
            relation: 'followUps',
            scope: {
              order: ['createdAt DESC'],
              limit: 1
            }
          }
        ],
        where: {
          followUp: {
            neq: null
          }
        }
      })
      // filter out contacts whose last follow up is not performed or is missing
      .then((contacts) => {
        return contacts.filter((contact) =>
          contact.followUps.length ? (!contact.followUps()[0].performed || contact.followUps()[0].lostToFollowUp) : false
        );
      });
  };
};
