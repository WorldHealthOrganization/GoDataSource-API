'use strict';

const app = require('../../server/server');
const moment = require('moment');
const _ = require('lodash');
const helpers = require('../../components/helpers');
const exportHelper = require('./../../components/exportHelper');
const FollowupGeneration = require('../../components/followupGeneration');
const RoundRobin = require('rr');
const Timer = require('../../components/Timer');
const Uuid = require('uuid');

module.exports = function (FollowUp) {
  // set flag to not get controller
  FollowUp.hasController = false;

  FollowUp.statusAcronymMap = {
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED_ACRONYM',
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK_ACRONYM',
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK_ACRONYM',
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_MISSED': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_MISSED_ACRONYM',
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_ATTEMPTED': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_ATTEMPTED_ACRONYM'
  };

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
      },
      {
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_ATTEMPTED'
      }
    ]
  };

  // helper functions that indicates if a follow up is performed
  FollowUp.isPerformed = function (obj) {
    return [
      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK',
      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK'
    ].indexOf(obj.statusId) >= 0;
  };

  // map language token labels for model properties
  FollowUp.fieldLabelsMap = Object.assign({}, FollowUp.fieldLabelsMap, {
    [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER]: 'LNG_FOLLOW_UP_FIELD_LABEL_CREATED_BY_USER',
    [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER_ID]: 'LNG_FOLLOW_UP_FIELD_LABEL_CREATED_BY_USER_ID',
    [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER_FIRST_NAME]: 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER_LAST_NAME]: 'LNG_USER_FIELD_LABEL_LAST_NAME',
    [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER]: 'LNG_FOLLOW_UP_FIELD_LABEL_UPDATED_BY_USER',
    [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER_ID]: 'LNG_FOLLOW_UP_FIELD_LABEL_UPDATED_BY_USER_ID',
    [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER_FIRST_NAME]: 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER_LAST_NAME]: 'LNG_USER_FIELD_LABEL_LAST_NAME',
    'contact': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT',
    'contact.id': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_ID',
    'contact.visualId': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_VISUAL_ID',
    'contact.firstName': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FIRST_NAME',
    'contact.lastName': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_LAST_NAME',
    'contact.riskLevel': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_RISK_LEVEL',
    'contact.gender': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_GENDER',
    'contact.occupation': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_OCCUPATION',
    'contact.age': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_AGE',
    'contact.age.years': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_AGE_YEARS',
    'contact.age.months': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_AGE_MONTHS',
    'contact.dob': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_DOB',
    'contact.dateOfLastContact': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_DATE_OF_LAST_CONTACT',
    'contact.followUp': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FOLLOWUP',
    'contact.followUp.originalStartDate': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FOLLOWUP_ORIGINAL_START_DATE',
    'contact.followUp.startDate': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FOLLOWUP_START_DATE',
    'contact.followUp.endDate': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FOLLOWUP_END_DATE',
    'contact.followUp.status': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FOLLOWUP_STATUS',
    'date': 'LNG_FOLLOW_UP_FIELD_LABEL_DATE',
    'address': 'LNG_FOLLOW_UP_FIELD_LABEL_ADDRESS',
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'address.country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'address.city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'address.addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'address.postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'address.locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'address.geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'address.geoLocation.lat': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_LAT',
    'address.geoLocation.lng': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_LNG',
    'address.geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'address.phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'address.emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS',
    'fillLocation': 'LNG_FOLLOW_UP_FIELD_LABEL_FILL_LOCATION',
    'fillLocation.geoLocation': 'LNG_FILL_LOCATION_FIELD_LABEL_GEO_LOCATION',
    'fillLocation.geoLocation.lat': 'LNG_FILL_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'fillLocation.geoLocation.lng': 'LNG_FILL_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'index': 'LNG_FOLLOW_UP_FIELD_LABEL_INDEX',
    'teamId': 'LNG_FOLLOW_UP_FIELD_LABEL_TEAM',
    'statusId': 'LNG_FOLLOW_UP_FIELD_LABEL_STATUSID',
    [exportHelper.CUSTOM_COLUMNS.ALERTED]: 'LNG_FOLLOW_UP_FIELD_LABEL_ALERTED',
    'targeted': 'LNG_FOLLOW_UP_FIELD_LABEL_TARGETED',
    'comment': 'LNG_FOLLOW_UP_FIELD_LABEL_COMMENT',
    'responsibleUserId': 'LNG_FOLLOW_UP_FIELD_LABEL_RESPONSIBLE_USER_UUID', // required for import map
    'responsibleUser': 'LNG_FOLLOW_UP_FIELD_LABEL_RESPONSIBLE_USER_ID',
    'responsibleUser.id': 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    'responsibleUser.firstName': 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    'responsibleUser.lastName': 'LNG_USER_FIELD_LABEL_LAST_NAME',

    // must be last item from the list
    'questionnaireAnswers': 'LNG_FOLLOW_UP_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  });

  // map language token labels for export fields group
  FollowUp.exportFieldsGroup = {
    'LNG_COMMON_LABEL_EXPORT_GROUP_RECORD_CREATION_AND_UPDATE_DATA': {
      properties: [
        'id',
        'createdAt',
        [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER],
        [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER_ID],
        [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER_FIRST_NAME],
        [exportHelper.CUSTOM_COLUMNS.CREATED_BY_USER_LAST_NAME],
        'updatedAt',
        [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER],
        [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER_ID],
        [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER_FIRST_NAME],
        [exportHelper.CUSTOM_COLUMNS.UPDATED_BY_USER_LAST_NAME],
        'deleted',
        'deletedAt',
        'createdOn'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_CORE_DEMOGRAPHIC_DATA': {
      properties: [
        'contact',
        'contact.id',
        'contact.visualId',
        'contact.firstName',
        'contact.lastName',
        'contact.riskLevel',
        'contact.gender',
        'contact.occupation',
        'contact.age',
        'contact.age.years',
        'contact.age.months',
        'contact.dob',
        'contact.dateOfLastContact',
        'contact.followUp.originalStartDate',
        'contact.followUp.startDate',
        'contact.followUp.endDate',
        'contact.followUp.status',
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_EPIDEMIOLOGICAL_DATA': {
      properties: [
        'date',
        'index',
        'teamId',
        'statusId',
        [exportHelper.CUSTOM_COLUMNS.ALERTED],
        'targeted',
        'comment',
        'responsibleUser',
        'responsibleUser.id',
        'responsibleUser.firstName',
        'responsibleUser.lastName',
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
        'address.emailAddress',
        'fillLocation',
        'fillLocation.geoLocation',
        'fillLocation.geoLocation.lat',
        'fillLocation.geoLocation.lng'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA': {
      properties: [
        // the ids and identifiers fields for a location are added custom
      ],
      required: [
        'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_QUESTIONNAIRE_DATA': {
      properties: [
        'questionnaireAnswers'
      ]
    }
  };

  // default export order
  FollowUp.exportFieldsOrder = [
    'id',
    'date',
    'index'
  ];

  // merge merge properties so we don't remove anything from a array / properties defined as being "mergeble" in case we don't send the entire data
  // this is relevant only when we update a record since on create we don't have old data that we need to merge
  FollowUp.mergeFieldsOnUpdate = [
    'questionnaireAnswers'
  ];

  FollowUp.referenceDataFieldsToCategoryMap = {
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPE',
    'statusId': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE'
  };

  FollowUp.referenceDataFields = Object.keys(FollowUp.referenceDataFieldsToCategoryMap);

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  FollowUp.nestedGeoPoints = [
    'address.geoLocation',
    'fillLocation.geoLocation'
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
    'personId': {
      modelName: 'contact',
      useProperty: [
        'id',
        'visualId',
        'firstName',
        'lastName',
        'riskLevel',
        'gender',
        'occupation',
        'age',
        'dob',
        'dateOfLastContact',
        'followUp.originalStartDate',
        'followUp.startDate',
        'followUp.endDate',
        'followUp.status',
      ]
    },
    'teamId': {
      modelName: 'team',
      useProperty: 'name'
    },
    'createdBy': {
      modelName: 'user',
      useProperty: [
        'firstName',
        'lastName'
      ]
    },
    'updatedBy': {
      modelName: 'user',
      useProperty: [
        'firstName',
        'lastName'
      ]
    }
  };

  // used on importable file logic
  FollowUp.foreignKeyFields = {
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

  FollowUp.extendedForm = {
    template: 'contactFollowUpTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };

  /**
   * Get contact current address (if needed: if follow-up does not have an address set)
   * @param modelInstance
   * @return {*}
   */
  function getContactCurrentAddressIfNeeded(modelInstance) {
    // if the model instance has an address (check locationId (required field with no default value),
    // loopback automatically adds address object with default values) or is not linked to a person
    if (modelInstance.address && modelInstance.address.locationId || !modelInstance.personId) {
      // nothing left to do
      return Promise.resolve();
    } else {
      // find contact
      return app.models.person
        .findById(modelInstance.personId)
        .then((person) => {
          // ignore if not found (it's better to return an orphaned follow-up in a list instead of failing)
          if (!person) {
            return;
          }
          // if found, get current address
          let contactAddress = person.getCurrentAddress();
          // if current address present
          if (contactAddress) {
            // update follow-up address
            modelInstance.address = contactAddress;
          }
        });
    }
  }


  /**
   * Loaded hooks
   */
  FollowUp.observe('loaded', function (context, next) {
    getContactCurrentAddressIfNeeded(context.data)
      .then(
        () => next()
      )
      .catch(next);
  });

  /**
   * Update follow-up index (if needed)
   * @param context
   * @return {*}
   */
  function setFollowUpIndexIfNeeded(context) {
    // this needs to be done only for new instances (and not for sync)
    if (!context.isNewInstance || (context.options && context.options._sync)) {
      return Promise.resolve();
    }
    return app.models.person
      .findById(context.instance.personId)
      .then((person) => {
        if (!person) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.person.modelName,
            id: context.instance.personId
          });
        }
        if (!person.followUp) {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: `Contact record (id: '${person.id}) missing follow-up interval information`
          });
        }
        // set index based on the difference in days from start date until the follow up set date
        // index is incremented by 1 because if follow up is on exact start day, the counter starts with 0
        context.instance.index = helpers.getDaysSince(moment(person.followUp.startDate), context.instance.date) + 1;
      });
  }

  /**
   * Set follow-up address, if needed
   * @param context
   * @return {*}
   */
  function setFollowUpAddressIfNeeded(context) {
    // get data from context
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // check if follow-up has an address
    let hasAddress = _.get(data, 'source.all.address.locationId');
    // if follow-up has an address (check locationId (required field with no default value),
    // loopback automatically adds address object with default values)
    if (hasAddress) {
      // make sure address stays there
      return Promise.resolve();
    }
    // make sure we have person id (bulk delete/updates are missing this info)
    const personId = _.get(data, 'source.all.personId');
    // if there is no person id
    if (!personId) {
      // stop here
      return Promise.resolve();
    }
    // follow-up does not have an address, find it's contact
    return app.models.person
      .findById(personId)
      .then((person) => {
        // if the contact was not found, just continue (maybe this is a sync and contact was not synced yet)
        if (!person) {
          return;
        }
        // get current person address
        let contactAddress = person.getCurrentAddress();
        // if address was found
        if (contactAddress) {
          // update contact address
          _.set(data, 'target.address', contactAddress);
        }
      });
  }

  /**
   * Set follow-up team, if needed
   * @param context
   */
  function setFollowUpTeamIfNeeded(context) {
    // this needs to be done only for new instances (and not for sync)
    if (!context.isNewInstance || (context.options && context.options._sync)) {
      return Promise.resolve();
    }
    // get data from context
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // if we have team id in the request, don't do anything
    const teamId = _.get(data, 'source.all.teamId');
    if (teamId) {
      return Promise.resolve();
    }
    // make sure we have person id (bulk delete/updates are missing this info)
    const personId = _.get(data, 'source.all.personId');
    // if there is no person id
    if (!personId) {
      // stop here
      return Promise.resolve();
    }
    // get follow up's contact
    return app.models.person
      .findById(personId)
      .then((person) => {
        // if the contact was not found, just continue (maybe this is a sync and contact was not synced yet)
        if (!person) {
          return;
        }
        // get all teams and their locations to get eligible teams for each contact
        return FollowupGeneration
          .getAllTeamsWithLocationsIncluded()
          .then((teams) => {
            return FollowupGeneration
              .getContactFollowupEligibleTeams(person, teams)
              .then((eligibleTeams) => {
                // choose a random team
                _.set(data, 'target.teamId', RoundRobin(eligibleTeams));
              });
          });
      });
  }

  /**
   * Before save hooks
   */
  FollowUp.observe('before save', function (ctx, next) {
    // set usual place of residence locationId
    setUsualPlaceOfResidenceLocationId(ctx);

    // sort multi answer questions
    const data = ctx.isNewInstance ? ctx.instance : ctx.data;
    helpers.sortMultiAnswerQuestions(data);

    // retrieve outbreak data
    let model = _.get(ctx, 'options.remotingContext.instance');
    if (model) {
      if (!(model instanceof app.models.outbreak)) {
        model = undefined;
      }
    }

    // convert date fields to date before saving them in database
    helpers
      .convertQuestionStringDatesToDates(
        data,
        model ?
          model.contactFollowUpTemplate :
          null
      )
      .then(() => {
        // set follow-up index (if needed)
        setFollowUpIndexIfNeeded(ctx)
          // set follow-up address (if needed)
          .then(() => setFollowUpAddressIfNeeded(ctx))
          .then(() => setFollowUpTeamIfNeeded(ctx))
          .then(() => next())
          .catch(next);
      })
      .catch(next);
  });

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
    // set query id and start timer (for logging purposes)
    const queryId = Uuid.v4();
    const timer = new Timer();
    timer.start();

    // convert filter to mongodb filter structure
    filter = filter || {};
    filter.where = filter.where || {};

    // sanitize the filter
    let parsedFilter = app.utils.remote.convertLoopbackFilterToMongo(
      {
        $and: [
          // make sure we're only counting follow ups from the current outbreak
          {
            outbreakId: outbreakId
          },
          // conditions coming from request
          filter.where
        ]
      });

    // add soft deleted condition if not specified otherwise
    if (!filter.deleted) {
      parsedFilter = {
        $and: [
          parsedFilter,
          {
            deleted: false
          }
        ]
      };
    }

    // pipeline for database aggregate query
    const aggregatePipeline = [];

    // restrict the follow-ups list
    aggregatePipeline.push({
      $match: parsedFilter
    });

    // group follow-ups by team (those without team will go into 'null' section)
    // then sum them
    aggregatePipeline.push({
      $group: {
        _id: '$teamId',
        count: {
          $sum: 1
        }
      }
    });

    // retrieve each team information
    // do not unwind the data, it consumes too much memory
    // better transform it afterwards, as we don't have many team in the system anyways
    // localField: '_id' =>  must be _id because we group by team, and the results keeps the id of the team in _id and not in the teamId how it was per follow-up record
    aggregatePipeline.push({
      $lookup: {
        from: 'team',
        localField: '_id',
        foreignField: '_id',
        as: 'team'
      }
    });

    // log usage
    app.logger.info(`[QueryId: ${queryId}] Performing MongoDB aggregate request on collection '${FollowUp.modelName}': aggregate ${JSON.stringify(aggregatePipeline)}`);

    // retrieve data
    return app.dataSources.mongoDb.connector
      .collection(FollowUp.modelName)
      .aggregate(
        aggregatePipeline, {
          allowDiskUse: true
        }
      )
      .toArray()
      .then(data => {
        // log time need to execute query
        app.logger.info(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);

        // defensive checks
        data = data || [];

        const result = {
          team: {},
          count: 0 // this is total count of follow-ups from all the teams
        };

        // convert response into object
        // doing this before old implementation were returning in this format
        // and to avoid front end from changing their implementation as well
        // also format team property
        // as $lookup result is always an array, we need it an object
        // also system uses 'id' property, so replace internal _id prop with it
        for (let item of data) {
          if (
            Array.isArray(item.team) &&
            item.team.length
          ) {
            item.team = item.team[0];
          } else {
            item.team = '';
          }

          item.id = item._id || '';
          delete item._id;

          result.team[item.id] = {
            team: item.team,
            count: item.count
          };
          result.count += item.count;
        }
        return result;
      });
  };

  /**
   * Pre-filter follow-ups for an outbreak using related models (case, contact)
   * @param outbreak
   * @param filter Supports 'where.contact', 'where.case' MongoDB compatible queries, 'where.timeLastSeen', 'where.weekNumber' queries
   * @return {Promise<void | never>}
   */
  FollowUp.preFilterForOutbreak = function (outbreak, filter) {
    // set a default filter
    filter = filter || {};
    // get case query, if any
    let caseQuery = _.get(filter, 'where.case');
    // if found, remove it form main query
    if (caseQuery) {
      // replace nested geo points filters
      caseQuery = app.utils.remote.convertNestedGeoPointsFilterToMongo(
        app.models.case,
        caseQuery || {},
        true,
        undefined,
        true
      );

      // cleanup
      delete filter.where.case;
    }

    // get contact-of-contact query, if any
    let contactOfContactQuery = _.get(filter, 'where.contactOfContact');
    // if found, remove it form main query
    if (contactOfContactQuery) {
      // replace nested geo points filters
      contactOfContactQuery = app.utils.remote.convertNestedGeoPointsFilterToMongo(
        app.models.contactOfContact,
        contactOfContactQuery || {},
        true,
        undefined,
        true
      );

      // cleanup
      delete filter.where.contactOfContact;
    }
    // get contact query, if any
    let contactQuery = _.get(filter, 'where.contact');
    // if found, remove it form main query
    if (contactQuery) {
      // replace nested geo points filters
      contactQuery = app.utils.remote.convertNestedGeoPointsFilterToMongo(
        app.models.contact,
        contactQuery || {},
        true,
        undefined,
        true
      );

      // cleanup
      delete filter.where.contact;
    }
    // get time last seen, if any
    let timeLastSeen = _.get(filter, 'where.timeLastSeen');
    // if found, remove it form main query
    if (timeLastSeen != null) {
      delete filter.where.timeLastSeen;
    }
    // get week number, if any
    let weekNumber = _.get(filter, 'where.weekNumber');
    // if found, remove it form main query
    if (weekNumber != null) {
      delete filter.where.weekNumber;
    }
    // get main followUp query
    let followUpQuery = _.get(filter, 'where', {});
    let contactIds = [];
    // start with a resolved promise (so we can link others)
    let buildQuery = Promise.resolve();
    // if a case query is present
    if (caseQuery) {
      // restrict query to current outbreak
      caseQuery = {
        $and: [
          caseQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter cases based on query
      buildQuery = buildQuery
        .then(function () {
          return app.models.case
            .rawFind(caseQuery, {projection: {_id: 1}})
            .then(function (cases) {
              // build a list of case ids that passed the filter
              const caseIds = cases.map(caseRecord => caseRecord.id);
              // find relations with contacts for those cases
              return app.models.relationship
                .rawFind({
                  outbreakId: outbreak.id,
                  'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.id': {
                    $in: caseIds
                  }
                }, {
                  projection: {
                    persons: 1
                  },
                  // required to use index to improve greatly performance
                  hint: {
                    'persons.id': 1
                  }
                });
            })
            .then(function (relationships) {
              // build a list of contact ids from the found relations
              relationships.forEach(function (relation) {
                relation.persons.forEach(function (person) {
                  if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                    contactIds.push(person.id);
                  }
                });
              });
            });
        });
    }

    // if a contact of contact query is present
    if (contactOfContactQuery) {
      // restrict query to current outbreak
      contactOfContactQuery = {
        $and: [
          contactOfContactQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter contact of contacts based on query
      buildQuery = buildQuery
        .then(function () {
          return app.models.contactOfContact
            .rawFind(contactOfContactQuery, {projection: {_id: 1}})
            .then(function (contactOfContacts) {
              // build a list of contactOfContact ids that passed the filter
              const contactOfContactIds = contactOfContacts.map(contactOfContactRecord => contactOfContactRecord.id);
              // find relations with contacts for those contact of contacts
              return app.models.relationship
                .rawFind({
                  outbreakId: outbreak.id,
                  'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.id': {
                    $in: contactOfContactIds
                  }
                }, {
                  projection: {
                    persons: 1
                  },
                  // required to use index to improve greatly performance
                  hint: {
                    'persons.id': 1
                  }
                });
            })
            .then(function (relationships) {
              // build a list of contact ids from the found relations
              relationships.forEach(function (relation) {
                relation.persons.forEach(function (person) {
                  if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                    contactIds.push(person.id);
                  }
                });
              });
            });
        });
    }

    // if time last seen filter is present
    if (timeLastSeen != null) {
      buildQuery = buildQuery
        .then(function () {
          // find people that were seen pass the specified date
          return app.models.followUp
            .rawFind({
              outbreakId: outbreak.id,
              performed: true,
              date: {
                $gt: timeLastSeen
              }
            }, {
              projection: {personId: 1}
            })
            .then(function (followUps) {
              if (!contactQuery) {
                contactQuery = {};
              }
              // update contact query to exclude those people
              contactQuery = {
                $and: [
                  contactQuery,
                  {
                    _id: {
                      $nin: followUps.map(followUp => followUp.personId)
                    }
                  }
                ]
              };
            });
        });
    }
    return buildQuery
      .then(function () {
        // if contact Ids were specified
        if (contactIds.length) {
          // make sure there is a contact query
          if (!contactQuery) {
            contactQuery = {};
          }
          // update contact query to filter based on contactIds
          contactQuery = {
            $and: [
              contactQuery,
              {
                _id: {
                  $in: contactIds
                }
              }
            ]
          };
        }
        // if there is a contact query
        if (contactQuery) {
          // restrict it to current outbreak
          contactQuery = {
            $and: [
              contactQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };
          // query contacts
          return app.models.contact
            .rawFind(contactQuery, {projection: {_id: 1}})
            .then(function (contacts) {
              // update follow-up query, restrict it to the list of contacts found
              followUpQuery = {
                and: [
                  followUpQuery,
                  {
                    personId: {
                      inq: contacts.map(contact => contact.id)
                    }
                  }
                ]
              };
            });
        }
      })
      .then(function () {
        // restrict follow-up query to current outbreak
        followUpQuery = {
          and: [
            followUpQuery,
            {
              outbreakId: outbreak.id
            }
          ]
        };
        // if week number was specified
        if (weekNumber != null) {
          // restrict follow-ups to be in the specified week range
          followUpQuery.and.push({
            index: {
              between: [(weekNumber - 1) * 7 + 1, weekNumber * 7]
            }
          });
        }
        // return updated filter
        return Object.assign(filter, {where: followUpQuery});
      });
  };

  /**
   * Retrieve list of follow ups grouped by contact
   * Information about contact is returned as well
   * Also 'countOnly' flag is supported, in this case only the count of groups is returned as result
   * @param outbreakId
   * @param filter Supports 'where.contact' MongoDB compatible queries besides follow-ups conditions which are on the first level
   * @param options
   * @param countOnly
   * @param callback
   */
  FollowUp.getOrCountGroupedByPerson = function (outbreakId, filter, options, countOnly, callback) {
    // convert filter to mongodb filter structure
    filter = filter || {};
    filter.where = filter.where || {};

    // check if we have contact filters
    let buildQuery = Promise.resolve();
    if (!_.isEmpty(filter.where.contact)) {
      // retrieve contact query
      const contactQuery = {
        $and: [
          {
            outbreakId: outbreakId
          },
          filter.where.contact
        ]
      };

      // retrieve contacts
      buildQuery = buildQuery
        .then(() => {
          return app.models.person.rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(contactQuery),
            {projection: {_id: 1}});
        });

      // no need to send contact filter further, since this one is handled separately
      delete filter.where.contact;
    }

    // add geographical restriction to filter if needed
    buildQuery = buildQuery
      .then((contactIds) => {
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, filter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (filter.where = updatedFilter);

            // finished
            return contactIds;
          });
      });

    // retrieve range follow-ups
    buildQuery
      .then((contactIds) => {
        // parse filter
        const parsedFilter = app.utils.remote.convertLoopbackFilterToMongo(
          {
            $and: [
              // make sure we're only retrieving follow ups from the current outbreak
              // retrieve only non-deleted records
              {
                outbreakId: outbreakId,
                deleted: false
              },
              // filter by contact
              ...(contactIds === undefined ? [] : [{
                personId: {
                  $in: Array.from(new Set((contactIds || []).map((contactData) => contactData.id)))
                }
              }]),

              // conditions coming from request
              filter.where
            ]
          });

        // parse order props
        const knownOrderTypes = {
          ASC: 1,
          DESC: -1
        };
        const orderProps = {};
        if (Array.isArray(filter.order)) {
          filter.order.forEach((pair) => {
            // split prop and order type
            const split = pair.split(' ');
            // ignore if we don't receive a pair
            if (split.length !== 2) {
              return;
            }
            split[1] = split[1].toUpperCase();
            // make sure the order type is known
            if (!knownOrderTypes.hasOwnProperty(split[1])) {
              return;
            }
            orderProps[split[0]] = knownOrderTypes[split[1]];
          });
        }

        // mongodb aggregate pipeline
        const aggregatePipeline = [
          // match conditions for followups
          {
            $match: parsedFilter
          },
          // group follow ups by person id
          // structure after grouping (_id -> personId, followUps -> list of follow ups)
          {
            $group: {
              _id: '$personId',
              followUps: {
                $push: '$$ROOT'
              }
            }
          }
        ];

        if (!countOnly) {
          // add additional data transformation into pipeline, after pagination is done
          // otherwise we transform unnecessary amount of data, that actually should be excluded from result
          aggregatePipeline.push(
            {
              $lookup: {
                from: 'person',
                localField: '_id',
                foreignField: '_id',
                as: 'contacts'
              }
            },
            {
              $project: {
                _id: 0,
                contact: {
                  $arrayElemAt: [
                    '$contacts',
                    0
                  ]
                },
                followUps: 1
              }
            },
            // discard follow ups with contacts soft deleted
            {
              $match: {
                'contact.deleted': {
                  $ne: true
                }
              }
            }
          );

          // do not add sort with 0 items, it will throw error
          if (Object.keys(orderProps).length) {
            aggregatePipeline.push({
              $sort: orderProps
            });
          }

          // we only add pagination fields if they are numbers
          // otherwise aggregation will fail
          if (!isNaN(filter.skip)) {
            aggregatePipeline.push({
              $skip: filter.skip
            });
          }
          if (!isNaN(filter.limit)) {
            aggregatePipeline.push({
              $limit: filter.limit
            });
          }
        } else {
          // count only - we don't need the entire data
          aggregatePipeline.push(
            {
              $project: {
                _id: 1
              }
            }
          );
        }

        // run the aggregation against database
        const cursor = app.dataSources.mongoDb.connector
          .collection('followUp')
          .aggregate(
            aggregatePipeline, {
              allowDiskUse: true
            }
          );

        // get the records from the cursor
        cursor
          .toArray()
          .then((records) => {
            // do not send the results back, just the count
            if (countOnly) {
              return callback(null, {
                count: records.length
              });
            }

            // replace _id with id, to be consistent
            // & determine locations
            let locationIds = {};
            records.forEach((record) => {
              if (record.contact) {
                // replace _id
                record.contact.id = record.contact._id;
                delete record.contact._id;

                // determine current address & get location
                if (
                  record.contact.addresses &&
                  record.contact.addresses.length > 0
                ) {
                  const contactResidence = record.contact.addresses.find((address) => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
                  if (contactResidence.locationId) {
                    locationIds[contactResidence.locationId] = true;
                  }
                }
              }
              if (Array.isArray(record.followUps)) {
                record.followUps.forEach((followUp) => {
                  followUp.id = followUp._id;
                  delete followUp._id;
                });
              }
            });

            // retrieve current location for each contact
            locationIds = Object.keys(locationIds);
            if (!locationIds.length) {
              // there are no locations to retrieve, so we can send response to client
              return callback(null, records);
            }

            // retrieve locations
            return app.models.location
              .rawFind({
                id: {
                  $in: locationIds
                }
              })
              .then((locations) => {
                // map locations
                const locationsMap = _.transform(locations, (acc, location) => {
                  acc[location.id] = location;
                }, {});

                // set locations
                records.forEach((record) => {
                  // determine current address & get location
                  if (
                    record.contact &&
                    record.contact.addresses &&
                    record.contact.addresses.length > 0
                  ) {
                    const contactResidence = record.contact.addresses.find((address) => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
                    if (
                      contactResidence.locationId &&
                      locationsMap[contactResidence.locationId]
                    ) {
                      contactResidence.location = locationsMap[contactResidence.locationId];
                    }
                  }
                });

                // finished mapping locations
                return callback(null, records);
              });
          })
          .catch(callback);
      });
  };

  /**
   * Retrieve follow-ups using mongo aggregation directly
   * @param filter
   * @param countOnly Boolean
   */
  FollowUp.findAggregate = (
    filter,
    countOnly
  ) => {
    // must filter after lookup ?
    const matchAfterLookup = filter && filter.where && JSON.stringify(filter.where).indexOf('contact.') > -1;

    // include relationship ?
    let relations = [];
    if (
      !countOnly ||
      matchAfterLookup
    ) {
      relations.push({
        lookup: {
          from: 'person',
          localField: 'personId',
          foreignField: '_id',
          as: 'contact'
        },
        unwind: true
      });
    }

    // filter
    return app.models.followUp
      .rawFindAggregate(
        filter, {
          countOnly: countOnly,
          relations: relations,
          matchAfterLookup
        }
      ).then((followUps) => {
        // nothing to do if we just want to count follow-ups
        if (countOnly) {
          return followUps;
        }

        // format contact ids & addresses
        (followUps || []).forEach((followUp) => {
          // contact id
          if (followUp.contact) {
            followUp.contact.id = followUp.contact._id;
            delete followUp.contact._id;
          }

          // remap address lat & lng
          FollowUp.prepareDataForRead({
            data: followUp
          });
        });

        // finished
        return followUps;
      });
  };

  /**
   * Set usualPlaceOfResidenceLocationId when address is updated
   * @param context
   */
  function setUsualPlaceOfResidenceLocationId(context) {
    // define follow-up instance
    let followUpInstance;

    // if this is a new record
    if (context.isNewInstance) {
      // get instance data from the instance
      followUpInstance = context.instance;

      // set usualPlaceOfResidenceLocationId as null by default
      followUpInstance.usualPlaceOfResidenceLocationId = null;
    } else {
      // existing instance, we're interested only in what is modified
      followUpInstance = context.data;
    }

    // check if address field was touched
    if (followUpInstance.address === undefined) {
      return;
    }

    // follow-up address was touched; get new usualPlaceOfResidenceLocationId
    // follow-up address was changed
    if (
      // address was removed entirely
      followUpInstance.address === null ||
      // locationId was removed or not set
      !followUpInstance.address.locationId
    ) {
      // set usualPlaceOfResidenceLocationId
      followUpInstance.usualPlaceOfResidenceLocationId = null;
      return;
    }
    // address was updated, is usual place of residence and locationId was set
    else {
      // set usualPlaceOfResidenceLocationId
      followUpInstance.usualPlaceOfResidenceLocationId = followUpInstance.address.locationId;
      return;
    }
  }

  /**
   * Add geographical restriction in where prop of the filter for logged in user
   * Note: The updated where filter is returned by the Promise; If there filter doesn't need to be updated nothing will be returned
   * @param context Remoting context from which to get logged in user and outbreak
   * @param where Where filter from which to start
   * @returns {Promise<unknown>|Promise<T>|Promise<void>}
   */
  FollowUp.addGeographicalRestrictions = (context, where) => {
    let loggedInUser = context.req.authData.user;
    let outbreak = context.instance;

    if (!app.models.user.helpers.applyGeographicRestrictions(loggedInUser, outbreak)) {
      // no need to apply geographic restrictions
      return Promise.resolve();
    }

    // get user allowed locations
    return app.models.user.cache
      .getUserLocationsIds(loggedInUser.id)
      .then(userAllowedLocationsIds => {
        if (!userAllowedLocationsIds.length) {
          // need to get data from all locations
          return Promise.resolve();
        }

        // get query for allowed locations
        let allowedLocationsQuery = {
          // get models for the calculated locations and the ones that don't have a usual place of residence location set
          usualPlaceOfResidenceLocationId: {
            inq: userAllowedLocationsIds.concat([null])
          }
        };

        // append input query
        if (where && Object.keys(where).length) {
          allowedLocationsQuery = {
            and: [
              allowedLocationsQuery,
              where
            ]
          };
        }

        // update where to only query for allowed locations
        return Promise.resolve(allowedLocationsQuery);
      });
  };
};
