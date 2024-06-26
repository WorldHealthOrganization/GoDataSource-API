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
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (Outbreak) {
  /**
   * Generate list of follow ups
   * @param data Props: { startDate, endDate (both follow up dates are required), targeted (boolean) }
   * @param options
   * @param callback
   */
  Outbreak.prototype.generateFollowups = function (data, options, callback) {
    Outbreak.generateFollowupsForOutbreak(this, data, options, callback);
  };

  /**
   * Generate list of follow ups for a specific outbreak
   */
  Outbreak.generateFollowupsForOutbreak = function (outbreak, data, options, callback) {
    // inject platform identifier
    options.platform = options.platform ?
      options.platform :
      Platform.BULK;

    let errorMessage = '';

    // get entity type for which the follow-ups are generated
    const personType = data.personType === genericHelpers.PERSON_TYPE.CASE ?
      genericHelpers.PERSON_TYPE.CASE :
      genericHelpers.PERSON_TYPE.CONTACT;

    // cache outbreak's follow up options
    let outbreakGenerateFollowUpsCurrentDate;
    let outbreakFrequencyOfFollowUp;
    let outbreakFrequencyOfFollowUpPerDay;
    let outbreakTeamAssignmentAlgorithm;
    let outbreakGenerateFollowUpsOverwriteExisting;
    let outbreakGenerateFollowUpsKeepTeamAssignment;
    let outbreakIntervalOfFollowUp;
    let outbreakPeriodOfFollowup;
    if (personType === genericHelpers.PERSON_TYPE.CASE) {
      outbreakGenerateFollowUpsCurrentDate = outbreak.generateFollowUpsDateOfOnset;
      outbreakFrequencyOfFollowUp = outbreak.frequencyOfFollowUpCases;
      outbreakFrequencyOfFollowUpPerDay = outbreak.frequencyOfFollowUpPerDayCases;
      outbreakTeamAssignmentAlgorithm = outbreak.generateFollowUpsTeamAssignmentAlgorithmCases;
      outbreakGenerateFollowUpsOverwriteExisting = outbreak.generateFollowUpsOverwriteExistingCases;
      outbreakGenerateFollowUpsKeepTeamAssignment = outbreak.generateFollowUpsKeepTeamAssignmentCases;
      outbreakIntervalOfFollowUp = outbreak.intervalOfFollowUpCases;
      outbreakPeriodOfFollowup = outbreak.periodOfFollowupCases;
    } else {
      outbreakGenerateFollowUpsCurrentDate = outbreak.generateFollowUpsDateOfLastContact;
      outbreakFrequencyOfFollowUp = outbreak.frequencyOfFollowUp;
      outbreakFrequencyOfFollowUpPerDay = outbreak.frequencyOfFollowUpPerDay;
      outbreakTeamAssignmentAlgorithm = outbreak.generateFollowUpsTeamAssignmentAlgorithm;
      outbreakGenerateFollowUpsOverwriteExisting = outbreak.generateFollowUpsOverwriteExisting;
      outbreakGenerateFollowUpsKeepTeamAssignment = outbreak.generateFollowUpsKeepTeamAssignment;
      outbreakIntervalOfFollowUp = outbreak.intervalOfFollowUp;
      outbreakPeriodOfFollowup = outbreak.periodOfFollowup;
    }

    // outbreak follow up generate params sanity checks
    let invalidOutbreakParams = [];
    if (outbreakFrequencyOfFollowUp <= 0) {
      invalidOutbreakParams.push('frequencyOfFollowUp');
    }
    if (outbreakFrequencyOfFollowUpPerDay <= 0) {
      invalidOutbreakParams.push('frequencyOfFollowUpPerDay');
    }
    if (invalidOutbreakParams.length) {
      errorMessage += `Following outbreak params: [${Object.keys(invalidOutbreakParams).join(',')}] should be greater than 0`;
    }

    // parse start/end dates from request
    // if start date is not provided:
    // - use "today" if contact tracing should start with the date of the last contact
    // - otherwise, use "tomorrow"
    // if end date is not provided, use outbreak follow-up period
    let followupStartDate = data.startDate ?
      localizationHelper.getDateStartOfDay(data.startDate) : (
        outbreakGenerateFollowUpsCurrentDate ?
          localizationHelper.today() :
          localizationHelper.today().add(1, 'days')
      );
    let followupEndDate = localizationHelper.getDateEndOfDay(
      data.endDate ?
        data.endDate :
        followupStartDate.clone().add(
          outbreakPeriodOfFollowup > 0 ?
            outbreakPeriodOfFollowup - 1 :
            0,
          'days'
        )
    );

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

    // check if the follow-ups should be generated only for specific contacts.
    const contactIds = !data.contactIds ?
      [] :
      (
        Array.isArray(data.contactIds) ?
          data.contactIds :
          [data.contactIds]
      );

    // check if 'targeted' flag exists in the request, if not default to true
    // this flag will be set upon all generated follow ups
    let targeted = true;
    if (data.hasOwnProperty('targeted')) {
      targeted = data.targeted;
    }

    // get other generate follow-ups options
    let overwriteExistingFollowUps = typeof data.overwriteExistingFollowUps === 'boolean' ?
      data.overwriteExistingFollowUps :
      outbreakGenerateFollowUpsOverwriteExisting;
    let keepTeamAssignment = typeof data.keepTeamAssignment === 'boolean' ?
      data.keepTeamAssignment :
      outbreakGenerateFollowUpsKeepTeamAssignment;

    // get other generate follow-ups options
    let intervalOfFollowUp = typeof data.intervalOfFollowUp === 'string' ?
      data.intervalOfFollowUp :
      outbreakIntervalOfFollowUp;

    // retrieve list of contacts that are eligible for follow up generation
    // and those that have last follow up inconclusive

    // initialize generated followups count
    let followUpsCount = 0;

    // get number of contacts for which followups need to be generated
    FollowupGeneration
      .countContactsEligibleForFollowup(
        personType,
        followupStartDate.toDate(),
        followupEndDate.toDate(),
        outbreak.id,
        contactIds,
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
                  personType,
                  followupStartDate.toDate(),
                  followupEndDate.toDate(),
                  outbreak.id,
                  contactIds,
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
                            outbreakFrequencyOfFollowUp,
                            outbreakFrequencyOfFollowUpPerDay,
                            targeted,
                            overwriteExistingFollowUps,
                            teamAssignmentPerDay,
                            intervalOfFollowUp
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
   * Count the cases that are lost to follow-up
   * Note: The cases are counted in total and per team. If a case is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param options
   * @param filter
   */
  Outbreak.prototype.countCasesLostToFollowup = function (filter, options) {
    return Outbreak.helpers.countPersonsLostToFollowup(
      this,
      genericHelpers.PERSON_TYPE.CASE,
      filter,
      options
    );
  };

  /**
   * Count the contacts that are lost to follow-up
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param options
   * @param filter
   */
  Outbreak.prototype.countContactsLostToFollowup = function (filter, options) {
    return Outbreak.helpers.countPersonsLostToFollowup(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      filter,
      options
    );
  };

  /**
   * Count the cases not seen in the past X days
   * @param filter Besides the default filter properties this request also accepts 'noDaysNotSeen': number on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesNotSeenInXDays = function (filter, options, callback) {
    Outbreak.helpers.countPersonsNotSeenInXDays(
      this,
      genericHelpers.PERSON_TYPE.CASE,
      filter,
      options,
      callback
    );
  };

  /**
   * Count the contacts not seen in the past X days
   * @param filter Besides the default filter properties this request also accepts 'noDaysNotSeen': number on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsNotSeenInXDays = function (filter, options, callback) {
    Outbreak.helpers.countPersonsNotSeenInXDays(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      filter,
      options,
      callback
    );
  };

  /**
   * Count the seen cases
   * Note: The cases are counted in total and per team. If a case is seen by 2 teams it will be counted once in total and once per each team.
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesSeen = function (filter, options, callback) {
    Outbreak.helpers.countPersonsByFollowUpFilter({
      outbreakId: this.id,
      personType: genericHelpers.PERSON_TYPE.CASE,
      followUpFilter: app.models.followUp.seenFilter,
      resultProperty: 'casesSeenCount'
    },
    filter,
    options,
    callback
    );
  };

  /**
   * Count the seen contacts
   * Note: The contacts are counted in total and per team. If a contact is seen by 2 teams it will be counted once in total and once per each team.
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsSeen = function (filter, options, callback) {
    Outbreak.helpers.countPersonsByFollowUpFilter({
      outbreakId: this.id,
      personType: genericHelpers.PERSON_TYPE.CONTACT,
      followUpFilter: app.models.followUp.seenFilter,
      resultProperty: 'contactsSeenCount'
    },
    filter,
    options,
    callback
    );
  };

  /**
   * Count the cases that have followups scheduled and the cases with successful followups
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesWithSuccessfulFollowups = function (filter, options, callback) {
    Outbreak.helpers.countPersonsWithSuccessfulFollowups(
      this,
      genericHelpers.PERSON_TYPE.CASE,
      filter,
      options,
      callback
    );
  };

  /**
   * Count the contacts that have followups scheduled and the contacts with successful followups
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsWithSuccessfulFollowups = function (filter, options, callback) {
    Outbreak.helpers.countPersonsWithSuccessfulFollowups(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      filter,
      options,
      callback
    );
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
      let today = localizationHelper.getDateStartOfDay().toDate();
      let todayEndOfDay = localizationHelper.getDateEndOfDay().toDate();

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

          // get date
          const date = localizationHelper.getDateStartOfDay(followup.date).format('YYYY-MM-DD');

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
      let today = localizationHelper.getDateStartOfDay().toDate();
      let todayEndOfDay = localizationHelper.getDateEndOfDay().toDate();

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

          // get date
          const date = localizationHelper.getDateStartOfDay(followup.date).format('YYYY-MM-DD');

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
