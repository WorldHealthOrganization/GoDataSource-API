'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with follow-up related actions
 */

const app = require('../../server/server');
const FollowupGeneration = require('../../components/followupGeneration');
const PromisePool = require('es6-promise-pool');
const _ = require('lodash');
const Config = require('./../../server/config.json');
const genericHelpers = require('../../components/helpers');
const Platform = require('../../components/platform');
const WorkerRunner = require('./../../components/workerRunner');
const exportHelper = require('./../../components/exportHelper');

module.exports = function (Outbreak) {
  /**
   * Generate list of follow ups
   * @param data Props: { startDate, endDate (both follow up dates are required), targeted (boolean) }
   * @param options
   * @param callback
   */
  Outbreak.prototype.generateFollowups = function (data, options, callback) {
    // inject platform identifier
    options.platform = Platform.BULK;

    let errorMessage = '';

    // outbreak follow up generate params sanity checks
    let invalidOutbreakParams = [];
    if (this.frequencyOfFollowUp <= 0) {
      invalidOutbreakParams.push('frequencyOfFollowUp');
    }
    if (this.frequencyOfFollowUpPerDay <= 0) {
      invalidOutbreakParams.push('frequencyOfFollowUpPerDay');
    }
    if (invalidOutbreakParams.length) {
      errorMessage += `Following outbreak params: [${Object.keys(invalidOutbreakParams).join(',')}] should be greater than 0`;
    }

    // parse start/end dates from request
    let followupStartDate = genericHelpers.getDate(data.startDate);
    let followupEndDate = genericHelpers.getDateEndOfDay(data.endDate);

    // sanity checks for dates
    let invalidFollowUpDates = [];
    if (!followupStartDate.isValid()) {
      invalidFollowUpDates.push('startDate');
    }
    if (!followupEndDate.isValid()) {
      invalidFollowUpDates.push('endDate');
    }
    if (invalidFollowUpDates.length) {
      errorMessage += `Follow up: [${Object.keys(invalidOutbreakParams).join(',')}] are not valid dates`;
    }

    // if the error message is not empty, stop the request
    if (errorMessage) {
      return callback(
        app.utils.apiError.getError(
          'INVALID_GENERATE_FOLLOWUP_PARAMS',
          {
            details: errorMessage
          }
        )
      );
    }

    // check if 'targeted' flag exists in the request, if not default to true
    // this flag will be set upon all generated follow ups
    let targeted = true;
    if (data.hasOwnProperty('targeted')) {
      targeted = data.targeted;
    }

    // cache outbreak's follow up options
    let outbreakFollowUpFreq = this.frequencyOfFollowUp;
    let outbreakFollowUpPerDay = this.frequencyOfFollowUpPerDay;
    let outbreakTeamAssignmentAlgorithm = this.generateFollowUpsTeamAssignmentAlgorithm;

    // get other generate follow-ups options
    let overwriteExistingFollowUps = typeof data.overwriteExistingFollowUps === 'boolean' ?
      data.overwriteExistingFollowUps :
      this.generateFollowUpsOverwriteExisting;
    let keepTeamAssignment = typeof data.keepTeamAssignment === 'boolean' ?
      data.keepTeamAssignment :
      this.generateFollowUpsKeepTeamAssignment;

    // get other generate follow-ups options
    let intervalOfFollowUp = typeof data.intervalOfFollowUp === 'string' ?
      data.intervalOfFollowUp :
      this.intervalOfFollowUp;

    // check if contact tracing should start on the date of the last contact
    const generateFollowUpsDateOfLastContact = this.generateFollowUpsDateOfLastContact;

    // retrieve list of contacts that are eligible for follow up generation
    // and those that have last follow up inconclusive
    let outbreakId = this.id;

    // initialize generated followups count
    let followUpsCount = 0;

    // get number of contacts for which followups need to be generated
    FollowupGeneration
      .countContactsEligibleForFollowup(
        followupStartDate.toDate(),
        followupEndDate.toDate(),
        outbreakId,
        options
      )
      .then(contactsCount => {
        if (!contactsCount) {
          // 0 followups to generate
          return Promise.resolve();
        }

        // there are contacts for which we need to generate followups
        // get all teams and their locations to get eligible teams for each contact
        return FollowupGeneration
          .getAllTeamsWithLocationsIncluded(outbreakTeamAssignmentAlgorithm === 'LNG_REFERENCE_DATA_CATEGORY_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM_ROUND_ROBIN_NEAREST_FIT')
          .then((teams) => {
            // since each contact will have its own pool of eligible teams we might reach the scenario where
            // in a day only a team is assigned to all contacts and in the next day another team is assigned to all contacts
            // eg: all contacts have the same 2 teams assigned and we generate follow-ups for 2 days; following normal round robin we would reach the above scenario
            // in order to randomize the assignment we need to keep a map of team assignments per day
            let teamAssignmentPerDay = {};

            // create functions to be used in handleActionsInBatches
            const getActionsCount = function () {
              return Promise.resolve(contactsCount);
            };
            const getBatchData = function (batchNo, batchSize) {
              return FollowupGeneration
                .getContactsEligibleForFollowup(
                  followupStartDate.toDate(),
                  followupEndDate.toDate(),
                  outbreakId,
                  (batchNo - 1) * batchSize,
                  batchSize,
                  options
                );
            };
            const batchItemsAction = function (contacts) {
              // create promise queues for handling database operations
              const dbOpsQueue = FollowupGeneration.dbOperationsQueue(options);

              // initialize current contact index; used in promise pool generator
              let currentIndex = 0;

              let pool = new PromisePool(
                () => {
                  if (currentIndex >= contacts.length) {
                    return null;
                  }

                  const contact = contacts[currentIndex];
                  currentIndex++;
                  // get follow ups list for all contacts
                  // we don't need to retrieve only follow-ups from a specific location since we might want to overwrite them with the new address ?
                  return FollowupGeneration
                    .getContactFollowups(followupStartDate.toDate(), followupEndDate.toDate(), contact.id)
                    .then((followUps) => {
                      contact.followUpsList = followUps;

                      // get eligible teams for contact
                      return FollowupGeneration
                        .getContactFollowupEligibleTeams(contact, teams, !overwriteExistingFollowUps && keepTeamAssignment, outbreakTeamAssignmentAlgorithm)
                        .then((eligibleTeams) => {
                          contact.eligibleTeams = eligibleTeams;

                          // get a list of follow ups objects to insert and a list of ids to update
                          let generateResult = FollowupGeneration.generateFollowupsForContact(
                            contact,
                            contact.eligibleTeams,
                            {
                              startDate: followupStartDate,
                              endDate: followupEndDate
                            },
                            outbreakFollowUpFreq,
                            outbreakFollowUpPerDay,
                            targeted,
                            overwriteExistingFollowUps,
                            teamAssignmentPerDay,
                            intervalOfFollowUp,
                            generateFollowUpsDateOfLastContact
                          );

                          dbOpsQueue.enqueueForInsert(generateResult.add);
                          dbOpsQueue.enqueueForRecreate(generateResult.update);
                        });
                    });
                },
                100 // concurrency limit
              );

              let poolPromise = pool.start();

              return poolPromise
                // make sure the queue has emptied
                .then(() => dbOpsQueue.internalQueue.onIdle())
                // settle any remaining items that didn't reach the batch size
                .then(() => dbOpsQueue.settleRemaining())
                .then(() => dbOpsQueue.insertedCount())
                .then(count => {
                  // count newly created followups
                  followUpsCount += count;
                });
            };

            return genericHelpers.handleActionsInBatches(
              getActionsCount,
              getBatchData,
              batchItemsAction,
              null,
              _.get(Config, 'jobSettings.generateFollowups.batchSize', 1000),
              null,
              options.remotingContext.req.logger
            );
          });
      })
      .then(() => callback(null, {count: followUpsCount}))
      .catch((err) => callback(err));
  };

  /**
   * Bulk modify follow ups
   * @param where
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkModifyFollowUps = function (where, data, options, callback) {
    // since the query can return many results we will do the update in batches
    // Note: Updating each follow-up one by one in order for the "before/after save" hooks to be executed for each entry
    // container for count
    let followUpsCount = 0;

    // initialize parameters for handleActionsInBatches call
    const getActionsCount = () => {
      return app.models.followUp
        .count(where)
        .then(count => {
          // cache count
          followUpsCount = count;

          return Promise.resolve(count);
        });
    };

    const getBatchData = (batchNo, batchSize) => {
      // get follow-ups for batch
      return app.models.followUp
        .find({
          where: where,
          skip: (batchNo - 1) * batchSize,
          limit: batchSize,
          order: 'createdAt ASC'
        });
    };

    const itemAction = (followUpRecord) => {
      return followUpRecord.updateAttributes(data, options);
    };

    genericHelpers.handleActionsInBatches(
      getActionsCount,
      getBatchData,
      null,
      itemAction,
      _.get(Config, 'jobSettings.bulkModifyFollowUps.batchSize', 1000),
      10,
      options.remotingContext.req.logger
    )
      .then(() => {
        callback(null, {count: followUpsCount});
      })
      .catch(callback);
  };

  Outbreak.beforeRemote('prototype.findFollowUps', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak follow-ups
   * @param filter Supports 'where.contact', 'where.case' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.findFollowUps = function (filter, options, callback) {
    // pre-filter using related data (case, contact)
    app.models.followUp
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // replace nested geo points filters
        filter.where = app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.followUp,
          filter.where || {},
          true,
          undefined,
          true
        );

        // add geographical restriction to filter if needed
        return app.models.followUp
          .addGeographicalRestrictions(options.remotingContext, filter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (filter.where = updatedFilter);

            // find follow-ups using filter
            return app.models.followUp.findAggregate(
              filter
            );
          });
      })
      .then(function (followUps) {
        callback(null, followUps);
      })
      .catch(callback);
  };

  Outbreak.beforeRemote('prototype.filteredCountFollowUps', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });

  /**
   * Count outbreak follow-ups
   * @param filter Supports 'where.contact', 'where.case' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountFollowUps = function (filter, options, callback) {
    // pre-filter using related data (case, contact)
    app.models.followUp
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // replace nested geo points filters
        filter.where = app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.followUp,
          filter.where || {},
          true,
          undefined,
          true
        );

        // add geographical restriction to filter if needed
        return app.models.followUp
          .addGeographicalRestrictions(options.remotingContext, filter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (filter.where = updatedFilter);

            // count using query
            return app.models.followUp.findAggregate(
              filter,
              true
            );
          });
      })
      .then(function (followUps) {
        callback(null, followUps);
      })
      .catch(callback);
  };

  Outbreak.beforeRemote('prototype.exportFilteredFollowups', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });

  /**
   * Export a list of follow-ups for a contact
   * @param filter
   * @param exportType
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   * @returns {*}
   */
  Outbreak.prototype.exportFilteredFollowups = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    // parse includeCreatedByUser query param
    let includeCreatedByUser = false;
    if (filter.where.hasOwnProperty('includeCreatedByUser')) {
      includeCreatedByUser = filter.where.includeCreatedByUser;
      delete filter.where.includeCreatedByUser;
    }

    // parse includeUpdatedByUser query param
    let includeUpdatedByUser = false;
    if (filter.where.hasOwnProperty('includeUpdatedByUser')) {
      includeUpdatedByUser = filter.where.includeUpdatedByUser;
      delete filter.where.includeUpdatedByUser;
    }

    // parse includeAlerted query param
    let includeAlerted = false;
    if (filter.where.hasOwnProperty('includeAlerted')) {
      includeAlerted = filter.where.includeAlerted;
      delete filter.where.includeAlerted;
    }

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // support nested where.contact
    const attachContactCondition = (condition) => {
      // must initialize - where ?
      if (!filter.where) {
        filter.where = {};
      }

      // must initialize - where.contact ?
      let andArray = [];
      if (!filter.where.contact) {
        filter.where.contact = {
          $and: andArray
        };
      } else if (filter.where.contact.and) {
        andArray = filter.where.contact.and;
      } else if (filter.where.contact.$and) {
        andArray = filter.where.contact.$and;
      } else {
        filter.where.contact.$and = andArray;
      }

      // append condition
      andArray.push(condition);
    };
    const nestedSearchForRelationship = (searchObject) => {
      // nothing to do ?
      if (!searchObject) {
        return;
      }

      // array ?
      if (Array.isArray(searchObject)) {
        // process array
        searchObject.forEach((item) => {
          nestedSearchForRelationship(item);
        });

        // finished
        return;
      }

      // move to top in where since that is supported further
      if (typeof searchObject === 'object') {
        Object.keys(searchObject).forEach((objectKey) => {
          if (objectKey === 'contact') {
            attachContactCondition(searchObject[objectKey]);
            delete searchObject[objectKey];
          } else if (objectKey.startsWith('contact.')) {
            attachContactCondition({
              [objectKey.substring('contact.'.length)]: searchObject[objectKey]
            });
            delete searchObject[objectKey];
          }
        });
      }

      // search or items
      if (
        searchObject.or &&
        Array.isArray(searchObject.or)
      ) {
        nestedSearchForRelationship(searchObject.or);
      }

      // search $or items
      if (
        searchObject.$or &&
        Array.isArray(searchObject.$or)
      ) {
        nestedSearchForRelationship(searchObject.$or);
      }

      // search and items
      if (
        searchObject.and &&
        Array.isArray(searchObject.and)
      ) {
        nestedSearchForRelationship(searchObject.and);
      }

      // search $and items
      if (
        searchObject.$and &&
        Array.isArray(searchObject.$and)
      ) {
        nestedSearchForRelationship(searchObject.$and);
      }
    };

    // do this check only if we don't have something on first level already
    // transform nested to already first level supported prefilter where.contact
    if (
      filter.where &&
      !filter.where.contact
    ) {
      nestedSearchForRelationship(filter.where);
    }

    // prefilters
    const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
      filter, {
        outbreakId: this.id
      }, {
        contact: {
          collection: 'person',
          queryPath: 'where.contact',
          queryAppend: {
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          },
          localKey: 'personId',
          foreignKey: '_id'
        },
        case: {
          collection: 'person',
          queryPath: 'where.case',
          queryAppend: {
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
          },
          localKey: 'personId',
          // #TODO
          // - must implement later
          ignore: true
          // foreignKey: '....ce vine din relationship'
          // prefilters: {
          //   relationship: {
          //     collection: 'relationship',
          //     queryPath: 'where.relationship',
          //     localKey: '_id',
          //     foreignKey: 'persons[].id',
          //     foreignKeyArraySize: 2,
          //     prefilters: {
          //         contact: {
          //           collection: 'person...',
          //           queryPath: 'where.relationship',
          //           localKey: '_id',
          //           foreignKey: 'persons[].id',
          //           foreignKeyArraySize: 2
          //         }
          //       }
          //   }
          // }
        },

        // #TODO - implement
        // where.timeLastSeen
        // where.weekNumber
      }
    );

    // attach geo restrictions if necessary
    app.models.followUp
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then((updatedFilter) => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'followUp',
            modelName: app.models.followUp.modelName,
            scopeQuery: app.models.followUp.definition.settings.scope,
            excludeBaseProperties: app.models.followUp.definition.settings.excludeBaseProperties,
            arrayProps: undefined,
            fieldLabelsMap: app.models.followUp.fieldLabelsMap,
            exportFieldsGroup: app.models.followUp.exportFieldsGroup,
            exportFieldsOrder: app.models.followUp.exportFieldsOrder,
            locationFields: app.models.followUp.locationFields,

            // fields that we need to bring from db, but we don't want to include in the export
            // - responsibleUserId might be included since it is used on import, otherwise we won't have the ability to map this field
            projection: [
              'personId',
              'responsibleUserId',
              'createdBy',
              'updatedBy'
            ]
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get(options, 'accessToken.userId'),
            outbreakId: this.id,
            questionnaire: this.contactFollowUpTemplate ?
              this.contactFollowUpTemplate.toJSON() :
              undefined,
            useQuestionVariable,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId,
            includeCreatedByUser,
            includeUpdatedByUser,
            includeAlerted
          },
          prefilters, {
            followUpTeam: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'team',
              project: [
                '_id',
                'name'
              ],
              key: '_id',
              keyValue: `(followUp) => {
                return followUp && followUp.teamId ?
                  followUp.teamId :
                  undefined;
              }`,
              replace: {
                'teamId': {
                  value: 'followUpTeam.name'
                }
              }
            },
            contact: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'person',
              project: [
                '_id',
                'visualId',
                'firstName',
                'lastName',
                'riskLevel',
                'gender',
                'occupation',
                'age',
                'dob',
                'dateOfLastContact',
                'followUp'
              ],
              key: '_id',
              keyValue: `(followUp) => {
                return followUp && followUp.personId ?
                  followUp.personId :
                  undefined;
              }`
            },
            responsibleUser: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'user',
              project: [
                '_id',
                'firstName',
                'lastName'
              ],
              key: '_id',
              keyValue: `(item) => {
                return item && item.responsibleUserId ?
                  item.responsibleUserId :
                  undefined;
              }`
            }
          }
        );
      })
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
  };

  /**
   * Count the contacts that are lost to follow-up
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param options
   * @param filter
   */
  Outbreak.prototype.countContactsLostToFollowup = function (filter, options) {
    // get outbreakId
    let outbreakId = this.id;

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (classification) {
      delete filter.where.classification;
    }

    // create filter as we need to use it also after the relationships are found
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          followUp: {
            neq: null
          },
          'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP'
        }
      }, filter || {});

    // do we need to filter contacts by case classification ?
    let promise = Promise.resolve();
    if (classification) {
      // retrieve cases
      promise = promise
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: this.id,
              deleted: false,
              classification: app.utils.remote.convertLoopbackFilterToMongo(classification)
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: this.id,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          _filter.where = {
            $and: [
              _filter.where, {
                _id: {
                  $in: contactIds
                }
              }
            ]
          };
        });
    }

    // get contacts that are available for follow up generation
    return promise
      .then(() => {
        // add geographical restriction to filter if needed
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, _filter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (_filter.where = updatedFilter);

            // get all relationships between events and contacts, where the contacts were created sooner than 'noDaysNewContacts' ago
            return app.models.contact
              .rawFind(_filter.where)
              .then(function (contacts) {
                return {
                  contactsLostToFollowupCount: contacts.length,
                  contactIDs: contacts.map((contact) => contact.id)
                };
              });
          });
      });
  };

  /**
   * Count the contacts not seen in the past X days
   * @param filter Besides the default filter properties this request also accepts 'noDaysNotSeen': number on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsNotSeenInXDays = function (filter, options, callback) {
    filter = filter || {};
    // initialize noDaysNotSeen filter
    let noDaysNotSeen;
    // check if the noDaysNotSeen filter was sent; accepting it only on the first level
    noDaysNotSeen = _.get(filter, 'where.noDaysNotSeen');
    if (typeof noDaysNotSeen !== 'undefined') {
      // noDaysNotSeen was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNotSeen;
    } else {
      // get the outbreak noDaysNotSeen as the default noDaysNotSeen value
      noDaysNotSeen = this.noDaysNotSeen;
    }

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (classification) {
      delete filter.where.classification;
    }

    // get outbreakId
    let outbreakId = this.id;

    // get current date
    let now = genericHelpers.getDate();

    // get date from noDaysNotSeen days ago
    let xDaysAgo = now.clone().subtract(noDaysNotSeen, 'day');

    // get contact query
    let contactQuery = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter).contact;

    // by default, find contacts does not perform any task
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (classification) {
      // retrieve cases
      findContacts = findContacts
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: outbreakId,
              deleted: false,
              classification: app.utils.remote.convertLoopbackFilterToMongo(classification)
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: this.id,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          if (contactQuery) {
            contactQuery = {
              and: [
                contactQuery, {
                  id: {
                    inq: contactIds
                  }
                }
              ]
            };
          } else {
            contactQuery = {
              id: {
                inq: contactIds
              }
            };
          }
        });
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // add geographical restriction to filter if needed
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, contactQuery)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (contactQuery = updatedFilter);

            // no contact query
            if (!contactQuery) {
              return;
            }

            // if a contact query was specified
            return app.models.contact
              .rawFind({
                and: [
                  {outbreakId: outbreakId},
                  contactQuery
                ]
              }, {projection: {'_id': 1}})
              .then(function (contacts) {
                // return a list of contact ids
                return contacts.map(contact => contact.id);
              });
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        let followUpQuery = {
          where: {
            and: [
              {
                outbreakId: outbreakId
              },
              {
                // get follow-ups that were scheduled in the past noDaysNotSeen days
                date: {
                  between: [xDaysAgo, now]
                }
              },
              app.models.followUp.notSeenFilter
            ]
          }
        };

        // if a list of contact ids was specified
        if (contactIds) {
          // restrict list of follow-ups to the list fo contact ids
          followUpQuery.where.and.push({
            personId: {
              inq: contactIds
            }
          });
        }

        // get follow-ups
        return app.models.followUp.rawFind(
          app.utils.remote.mergeFilters(followUpQuery, filter || {}).where,
          {
            // order by date as we need to check the follow-ups from the oldest to the most new
            order: {date: 1}
          })
          .then(followUps => {
            const resultContactsList = [];
            // group follow ups per contact
            const groupedByContact = _.groupBy(followUps, (f) => f.personId);
            for (let contactId in groupedByContact) {
              // keep one follow up per day
              const contactFollowUps = [...new Set(groupedByContact[contactId].map((f) => f.index))];
              if (contactFollowUps.length === noDaysNotSeen) {
                resultContactsList.push(contactId);
              }
            }
            // send response
            return callback(null, {
              contactsCount: resultContactsList.length,
              contactIDs: resultContactsList
            });
          });
      })
      .catch(callback);
  };

  /**
   * Count the seen contacts
   * Note: The contacts are counted in total and per team. If a contact is seen by 2 teams it will be counted once in total and once per each team.
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsSeen = function (filter, options, callback) {
    Outbreak.helpers.countContactsByFollowUpFilter({
      outbreakId: this.id,
      followUpFilter: app.models.followUp.seenFilter,
      resultProperty: 'contactsSeenCount'
    }, filter, options, callback);
  };

  /**
   * Count the contacts that have followups scheduled and the contacts with successful followups
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsWithSuccessfulFollowups = function (filter, options, callback) {
    filter = filter || {};
    const FollowUp = app.models.followUp;

    // initialize result
    let result = {
      totalContactsWithFollowupsCount: 0,
      contactsWithSuccessfulFollowupsCount: 0,
      teams: [],
      contacts: []
    };

    // get outbreakId
    let outbreakId = this.id;

    // retrieve relations queries
    const relationsQueries = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);

    // get contact query, if any
    let contactQuery = relationsQueries.contact;

    // get case query, if any
    const caseQuery = relationsQueries.case;

    // by default, find contacts does not perform any task
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (caseQuery) {
      // retrieve cases
      findContacts = findContacts
        .then(() => {
          return app.models.case
            .rawFind({
              and: [
                caseQuery, {
                  outbreakId: outbreakId,
                  deleted: false
                }
              ]
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: outbreakId,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          if (contactQuery) {
            contactQuery = {
              and: [
                contactQuery, {
                  id: {
                    inq: contactIds
                  }
                }
              ]
            };
          } else {
            contactQuery = {
              id: {
                inq: contactIds
              }
            };
          }
        });
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // add geographical restriction to filter if needed
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, contactQuery)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (contactQuery = updatedFilter);

            // no contact query
            if (!contactQuery) {
              return;
            }

            // if a contact query was specified
            return app.models.contact
              .rawFind({and: [contactQuery, {outbreakId: outbreakId}]}, {projection: {_id: 1}})
              .then(function (contacts) {
                // return a list of contact ids
                return contacts.map(contact => contact.id);
              });
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        // build follow-up filter
        let _filter = {
          where: {
            outbreakId: outbreakId
          }
        };
        // if contact ids were specified
        if (contactIds) {
          // restrict follow-up query to those ids
          _filter.where.personId = {
            inq: contactIds
          };
        }
        // get all the followups for the filtered period
        return FollowUp.rawFind(app.utils.remote
          .mergeFilters(_filter, filter || {}).where)
          .then(function (followups) {
            // filter by relation properties
            followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

            // initialize teams map and contacts map as the request needs to count contacts
            let teamsMap = {};
            let contactsMap = {};
            // initialize helper contacts to team map
            let contactsTeamMap = {};

            followups.forEach(function (followup) {
              // get contactId
              let contactId = followup.personId;
              // get teamId; there might be no team id, set null
              let teamId = followup.teamId || null;

              // check if a followup for the same contact was already parsed
              if (contactsTeamMap[contactId]) {
                // check if there was another followup for the same team
                // if so check for the performed flag;
                // if the previous followup was performed there is no need to update any team contacts counter;
                // total and successful counters were already updated
                if (contactsTeamMap[contactId].teams[teamId]) {
                  // new follow-up for the contact from the same team is performed; update flag and increase successful counter
                  if (!contactsTeamMap[contactId].teams[teamId].performed && FollowUp.isPerformed(followup) === true) {
                    // update performed flag
                    contactsTeamMap[contactId].teams[teamId].performed = true;
                    // increase successful counter for team
                    teamsMap[teamId].contactsWithSuccessfulFollowupsCount++;
                    // update followedUpContactsIDs/missedContactsIDs lists
                    teamsMap[teamId].followedUpContactsIDs.push(contactId);
                    teamsMap[teamId].missedContactsIDs.splice(teamsMap[teamId].missedContactsIDs.indexOf(contactId), 1);
                  }
                } else {
                  // new teamId
                  // cache followup performed information for contact in team
                  contactsTeamMap[contactId].teams[teamId] = {
                    performed: FollowUp.isPerformed(followup)
                  };

                  // initialize team entry if doesn't already exist
                  if (!teamsMap[teamId]) {
                    teamsMap[teamId] = {
                      id: teamId,
                      totalContactsWithFollowupsCount: 0,
                      contactsWithSuccessfulFollowupsCount: 0,
                      followedUpContactsIDs: [],
                      missedContactsIDs: []
                    };
                  }

                  // increase team counters
                  teamsMap[teamId].totalContactsWithFollowupsCount++;
                  if (FollowUp.isPerformed(followup)) {
                    teamsMap[teamId].contactsWithSuccessfulFollowupsCount++;
                    // keep contactId in the followedUpContactsIDs list
                    teamsMap[teamId].followedUpContactsIDs.push(contactId);
                  } else {
                    // keep contactId in the missedContactsIDs list
                    teamsMap[teamId].missedContactsIDs.push(contactId);
                  }
                }
              } else {
                // first followup for the contact; add it in the contactsMap
                contactsMap[contactId] = {
                  id: contactId,
                  totalFollowupsCount: 0,
                  successfulFollowupsCount: 0
                };

                // cache followup performed information for contact in team and overall
                contactsTeamMap[contactId] = {
                  teams: {
                    [teamId]: {
                      performed: FollowUp.isPerformed(followup)
                    }
                  },
                  performed: FollowUp.isPerformed(followup),
                };

                // increase overall counters
                result.totalContactsWithFollowupsCount++;

                // initialize team entry if doesn't already exist
                if (!teamsMap[teamId]) {
                  teamsMap[teamId] = {
                    id: teamId,
                    totalContactsWithFollowupsCount: 0,
                    contactsWithSuccessfulFollowupsCount: 0,
                    followedUpContactsIDs: [],
                    missedContactsIDs: []
                  };
                }

                // increase team counters
                teamsMap[teamId].totalContactsWithFollowupsCount++;
                if (FollowUp.isPerformed(followup)) {
                  teamsMap[teamId].contactsWithSuccessfulFollowupsCount++;
                  // keep contactId in the followedUpContactsIDs list
                  teamsMap[teamId].followedUpContactsIDs.push(contactId);
                  // increase total successful total counter
                  result.contactsWithSuccessfulFollowupsCount++;
                } else {
                  // keep contactId in the missedContactsIDs list
                  teamsMap[teamId].missedContactsIDs.push(contactId);
                }
              }

              // update total follow-ups counter for contact
              contactsMap[contactId].totalFollowupsCount++;
              if (FollowUp.isPerformed(followup)) {
                // update counter for contact successful follow-ups
                contactsMap[contactId].successfulFollowupsCount++;

                // check if contact didn't have a successful followup and the current one was performed
                // as specified above for teams this is the only case where updates are needed
                if (!contactsTeamMap[contactId].performed) {
                  // update overall performed flag
                  contactsTeamMap[contactId].performed = true;
                  // increase total successful total counter
                  result.contactsWithSuccessfulFollowupsCount++;
                }
              }
            });

            // update results; sending array with teams and contacts information
            result.teams = Object.values(teamsMap);
            result.contacts = Object.values(contactsMap);

            // send response
            callback(null, result);
          });
      })
      .catch(callback);
  };

  /**
   * Count the followups per team per day
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countFollowUpsPerTeamPerDay = function (filter, options, callback) {
    // initialize result
    let result = {
      totalFollowupsCount: 0,
      successfulFollowupsCount: 0,
      teams: []
    };

    // get outbreakId
    let outbreakId = this.id;

    // initialize default filter
    let defaultFilter = {
      where: {
        outbreakId: outbreakId
      },
      order: 'date ASC'
    };

    // check if the filter includes date; if not, set the filter to get all the follow-ups from today by default
    if (!filter || !filter.where || JSON.stringify(filter.where).indexOf('date') === -1) {
      // to get the entire day today, filter between today 00:00 and tomorrow 00:00
      let today = genericHelpers.getDate().toString();
      let todayEndOfDay = genericHelpers.getDateEndOfDay().toString();

      defaultFilter.where.date = {
        between: [today, todayEndOfDay]
      };
    }

    // retrieve all teams to make sure that follow-ups teams still exist
    // - there is no need right now to restrict teams by locations to which I have access since there will be just a small number of teams and they will be filter out further
    let existingTeamsMap = {};
    app.models.team
      .find({
        fields: {
          id: true
        }
      })
      .then(function (teams) {
        // map teams
        teams.forEach((team) => {
          existingTeamsMap[team.id] = true;
        });

        // construct follow-up filter
        const followUpFilter = app.utils.remote.mergeFilters(
          defaultFilter,
          filter || {}
        );

        // define fields that we always need to retrieve
        // there is no point why frontend will request other fields since we don't return follow-ups
        followUpFilter.fields = {
          personId: true,
          teamId: true,
          date: true,
          statusId: true
        };

        // get all the followups for the filtered period
        // add geographical restriction to filter if needed
        return app.models.followUp
          .addGeographicalRestrictions(options.remotingContext, followUpFilter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (followUpFilter.where = updatedFilter);

            // retrieve follow-ups
            return app.models.followUp
              .find(followUpFilter);
          });
      })
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);
        // initialize teams map
        let teamsMap = {};
        // initialize helper team to date to contacts map
        let teamDateContactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          const contactId = followup.personId;

          // get teamId; there might be no team id, set null
          let teamId;
          if (
            followup.teamId &&
            existingTeamsMap[followup.teamId]
          ) {
            teamId = followup.teamId;
          } else {
            teamId = null;
          }

          // get date; format it to UTC 00:00:00
          const date = genericHelpers.getDate(followup.date).toString();

          // initialize team entry if not already initialized
          if (!teamsMap[teamId]) {
            teamsMap[teamId] = {
              id: teamId,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              dates: {}
            };

            teamDateContactsMap[teamId] = {};
          }

          // initialize date entry for the team if not already initialized
          if (!teamsMap[teamId].dates[date]) {
            teamsMap[teamId].dates[date] = {
              date: date,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              contactIDs: []
            };

            teamDateContactsMap[teamId][date] = {};
          }

          // increase counters
          teamsMap[teamId].dates[date].totalFollowupsCount++;
          teamsMap[teamId].totalFollowupsCount++;

          if (app.models.followUp.isPerformed(followup)) {
            teamsMap[teamId].dates[date].successfulFollowupsCount++;
            teamsMap[teamId].successfulFollowupsCount++;
            result.successfulFollowupsCount++;
          }

          // add contactId to the team/date container if not already added
          if (!teamDateContactsMap[teamId][date][contactId]) {
            // keep flag to not add contact twice for team
            teamDateContactsMap[teamId][date][contactId] = true;
            teamsMap[teamId].dates[date].contactIDs.push(contactId);
          }
        });

        // update results; sending array with teams and contacts information
        result.totalFollowupsCount = followups.length;
        result.teams = _.map(teamsMap, (value) => {
          value.dates = Object.values(value.dates);
          return value;
        });

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the followups per user per day
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countFollowUpsPerUserPerDay = function (filter, options, callback) {
    // initialize result
    let result = {
      totalFollowupsCount: 0,
      successfulFollowupsCount: 0,
      users: []
    };

    // get outbreakId
    let outbreakId = this.id;

    // initialize default filter
    let defaultFilter = {
      where: {
        outbreakId: outbreakId
      },
      order: 'date ASC'
    };

    // check if the filter includes date; if not, set the filter to get all the follow-ups from today by default
    if (!filter || !filter.where || JSON.stringify(filter.where).indexOf('date') === -1) {
      // to get the entire day today, filter between today 00:00 and tomorrow 00:00
      let today = genericHelpers.getDate().toString();
      let todayEndOfDay = genericHelpers.getDateEndOfDay().toString();

      defaultFilter.where.date = {
        between: [today, todayEndOfDay]
      };
    }

    // retrieve all users to make sure that follow-ups users still exist
    // - there is no need right now to restrict users by locations to which I have access since there will be just a small number of users and they will be filter out further
    let existingUsersMap = {};
    app.models.user
      .find({
        fields: {
          id: true
        }
      })
      .then(function (users) {
        // map users
        users.forEach((user) => {
          existingUsersMap[user.id] = true;
        });

        // construct follow-up filter
        const followUpFilter = app.utils.remote.mergeFilters(
          defaultFilter,
          filter || {}
        );

        // define fields that we always need to retrieve
        // there is no point why frontend will request other fields since we don't return follow-ups
        followUpFilter.fields = {
          personId: true,
          responsibleUserId: true,
          date: true,
          statusId: true
        };

        // get all the followups for the filtered period
        // add geographical restriction to filter if needed
        return app.models.followUp
          .addGeographicalRestrictions(options.remotingContext, followUpFilter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (followUpFilter.where = updatedFilter);

            // retrieve follow-ups
            return app.models.followUp
              .find(followUpFilter);
          });
      })
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);
        // initialize users map
        let usersMap = {};
        // initialize helper user to date to contacts map
        let userDateContactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          const contactId = followup.personId;

          // get responsibleUserId; there might be no user id, set null
          let responsibleUserId;
          if (
            followup.responsibleUserId &&
            existingUsersMap[followup.responsibleUserId]
          ) {
            responsibleUserId = followup.responsibleUserId;
          } else {
            responsibleUserId = null;
          }

          // get date; format it to UTC 00:00:00
          const date = genericHelpers.getDate(followup.date).toString();

          // initialize user entry if not already initialized
          if (!usersMap[responsibleUserId]) {
            usersMap[responsibleUserId] = {
              id: responsibleUserId,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              dates: {}
            };

            userDateContactsMap[responsibleUserId] = {};
          }

          // initialize date entry for the user if not already initialized
          if (!usersMap[responsibleUserId].dates[date]) {
            usersMap[responsibleUserId].dates[date] = {
              date: date,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              contactIDs: []
            };

            userDateContactsMap[responsibleUserId][date] = {};
          }

          // increase counters
          usersMap[responsibleUserId].dates[date].totalFollowupsCount++;
          usersMap[responsibleUserId].totalFollowupsCount++;

          if (app.models.followUp.isPerformed(followup)) {
            usersMap[responsibleUserId].dates[date].successfulFollowupsCount++;
            usersMap[responsibleUserId].successfulFollowupsCount++;
            result.successfulFollowupsCount++;
          }

          // add contactId to the user/date container if not already added
          if (!userDateContactsMap[responsibleUserId][date][contactId]) {
            // keep flag to not add contact twice for user
            userDateContactsMap[responsibleUserId][date][contactId] = true;
            usersMap[responsibleUserId].dates[date].contactIDs.push(contactId);
          }
        });

        // update results; sending array with users and contacts information
        result.totalFollowupsCount = followups.length;
        result.users = _.map(usersMap, (value) => {
          value.dates = Object.values(value.dates);
          return value;
        });

        // send response
        callback(null, result);
      })
      .catch(callback);
  };


  Outbreak.beforeRemote('prototype.countFollowUpsByTeam', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });

  /**
   * Count follow-ups grouped by associated team. Supports 'where.contact', 'where.case' MongoDB compatible queries
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countFollowUpsByTeam = function (filter, options, callback) {
    const self = this;
    // pre-filter using related data (case, contact)
    app.models.followUp
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // add geographical restriction to filter if needed
        return app.models.followUp
          .addGeographicalRestrictions(options.remotingContext, filter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (filter.where = updatedFilter);

            // finished
            return filter;
          });
      })
      .then(function (filter) {
        // find follow-ups using filter
        return app.models.followUp
          .countByTeam(self.id, filter);
      })
      .then(function (results) {
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Get follow ups grouped by contact
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getFollowUpsGroupedByContact = function (filter, options, callback) {
    app.models.followUp.getOrCountGroupedByPerson(this.id, filter, options, false, callback);
  };

  /**
   * Count follow ups grouped by contact
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countFollowUpsGroupedByContact = function (filter, options, callback) {
    app.models.followUp.getOrCountGroupedByPerson(this.id, filter, options, true, callback);
  };
};
