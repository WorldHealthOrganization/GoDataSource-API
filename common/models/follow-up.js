'use strict';

const app = require('../../server/server');
const moment = require('moment');
const _ = require('lodash');
const helpers = require('../../components/helpers');
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
    'contact': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT',
    'contact.id': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_ID',
    'contact.visualId': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_VISUAL_ID',
    'contact.firstName': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_FIRST_NAME',
    'contact.lastName': 'LNG_FOLLOW_UP_FIELD_LABEL_CONTACT_LAST_NAME',
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
    'address.geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'address.emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS',
    'fillLocation': 'LNG_FOLLOW_UP_FIELD_LABEL_FILL_LOCATION',
    'fillLocation.geoLocation': 'LNG_FILL_LOCATION_FIELD_LABEL_GEO_LOCATION',
    'fillLocation.geoLocation.lat': 'LNG_FILL_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'fillLocation.geoLocation.lng': 'LNG_FILL_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'index': 'LNG_FOLLOW_UP_FIELD_LABEL_INDEX',
    'teamId': 'LNG_FOLLOW_UP_FIELD_LABEL_TEAM',
    'statusId': 'LNG_FOLLOW_UP_FIELD_LABEL_STATUSID',
    'isGenerated': 'LNG_FOLLOW_UP_FIELD_LABEL_IS_GENERATED',
    'targeted': 'LNG_FOLLOW_UP_FIELD_LABEL_TARGETED',
    'comment': 'LNG_FOLLOW_UP_FIELD_LABEL_COMMENT',

    // must be last item from the list
    'questionnaireAnswers': 'LNG_FOLLOW_UP_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  });

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
        'lastName'
      ]
    },
    'teamId': {
      modelName: 'team',
      useProperty: 'name'
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
            $or: [
              {
                deleted: false
              },
              {
                deleted: {
                  $eq: null
                }
              }
            ]
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
    aggregatePipeline.push({
      $lookup: {
        from: 'team',
        localField: 'teamId',
        foreignField: '_id',
        as: 'team'
      }
    });

    // log usage
    app.logger.info(`[QueryId: ${queryId}] Performing MongoDB aggregate request on collection '${FollowUp.modelName}': aggregate ${JSON.stringify(aggregatePipeline)}`);

    // retrieve data
    return app.dataSources.mongoDb.connector
      .collection(FollowUp.modelName)
      .aggregate(aggregatePipeline)
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
          if (Array.isArray(item) && item.length) {
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
      delete filter.where.case;
    }
    // get contact query, if any
    let contactQuery = _.get(filter, 'where.contact');
    // if found, remove it form main query
    if (contactQuery) {
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
    let contactIds;
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
                  projection: {persons: 1}
                });
            })
            .then(function (relationships) {
              // build a list of contact ids from the found relations
              contactIds = [];
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
        if (contactIds) {
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
   * @param countOnly
   * @param callback
   */
  FollowUp.getOrCountGroupedByPerson = function (outbreakId, filter, countOnly, callback) {
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
          return app.models.contact.rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(contactQuery),
            {projection: {_id: 1}});
        });

      // no need to send contact filter further, since this one is handled separately
      delete filter.where.contact;
    }

    // retrieve range follow-ups
    buildQuery
      .then((contactIds) => {
        // parse filter
        const parsedFilter = app.utils.remote.convertLoopbackFilterToMongo(
          {
            $and: [
              // make sure we're only retrieving follow ups from the current outbreak
              {
                outbreakId: outbreakId
              },
              // retrieve only non-deleted records
              {
                $or: [
                  {
                    deleted: false
                  },
                  {
                    deleted: {
                      $eq: null
                    }
                  }
                ]
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
                $or: [
                  {
                    'contact.deleted': false
                  },
                  {
                    'contact.deleted': {
                      $eq: null
                    }
                  }
                ]
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
        }

        // run the aggregation against database
        const cursor = app.dataSources.mongoDb.connector.collection('followUp').aggregate(aggregatePipeline);

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
                if (!_.isEmpty(record.contact.addresses)) {
                  const contactResidence = record.contact.addresses.find((address) => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
                  if (!_.isEmpty(contactResidence.locationId)) {
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
            if (_.isEmpty(locationIds)) {
              // there are no locations to retrieve so we can send response to client
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
                  if (!_.isEmpty(record.contact.addresses)) {
                    const contactResidence = record.contact.addresses.find((address) => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
                    if (
                      !_.isEmpty(contactResidence.locationId) &&
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
    let relations = [];
    if (!countOnly) {
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
    return app.models.followUp
      .rawFindAggregate(
        filter, {
          countOnly: countOnly,
          relations: relations
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
   * Migrate follow-ups
   * @param options
   * @param next
   */
  FollowUp.migrate = (options, next) => {
    // retrieve outbreaks data so we can migrate questionnaires accordingly to outbreak template definitiuon
    app.models.outbreak
      .find({}, {
        projection: {
          _id: 1,
          contactFollowUpTemplate: 1
        }
      })
      .then((outbreakData) => {
        // map outbreak data
        const outbreakTemplates = _.transform(
          outbreakData,
          (a, m) => {
            a[m.id] = m.contactFollowUpTemplate;
          },
          {}
        );

        // migrate dates & numbers
        helpers.migrateModelDataInBatches(FollowUp, (modelData, cb) => {
          if (!_.isEmpty(modelData.questionnaireAnswers)) {
            // convert dates
            const questionnaireAnswersClone = _.cloneDeep(modelData.questionnaireAnswers);
            helpers
              .convertQuestionStringDatesToDates(
                modelData,
                outbreakTemplates[modelData.outbreakId]
              )
              .then(() => {
                // check if we have something to change
                if (_.isEqual(modelData.questionnaireAnswers, questionnaireAnswersClone)) {
                  // nothing to change
                  cb();
                } else {
                  // migrate
                  modelData
                    .updateAttributes({
                      questionnaireAnswers: modelData.questionnaireAnswers
                    }, options)
                    .then(() => cb())
                    .catch(cb);
                }
              })
              .catch(cb);
          } else {
            // nothing to do
            cb();
          }
        })
          .then(() => next())
          .catch(next);
      })
      .catch(next);
  };
};
