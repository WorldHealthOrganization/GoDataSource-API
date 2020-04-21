'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with follow-up related actions
 */

const app = require('../../server/server');
const helpers = require('../../components/helpers');
const FollowupGeneration = require('../../components/followupGeneration');
const PromisePool = require('es6-promise-pool');

module.exports = function (Outbreak) {
  /**
   * Generate list of follow ups
   * @param data Props: { startDate, endDate (both follow up dates are required), targeted (boolean) }
   * @param options
   * @param callback
   */
  Outbreak.prototype.generateFollowups = function (data, options, callback) {
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
    let followupStartDate = helpers.getDate(data.startDate);
    let followupEndDate = helpers.getDateEndOfDay(data.endDate);

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
        outbreakId
      )
      .then(contactsCount => {
        if (!contactsCount) {
          // 0 followups to generate
          return Promise.resolve();
        }

        // there are contacts for which we need to generate followups
        // get all teams and their locations to get eligible teams for each contact
        return FollowupGeneration
          .getAllTeamsWithLocationsIncluded()
          .then((teams) => {
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
                  batchSize
                );
            };
            const batchItemsAction = function (contacts) {
              // get follow ups list for all contacts
              return FollowupGeneration
                .getContactFollowups(followupStartDate.toDate(), followupEndDate.toDate(), contacts.map(c => c.id))
                .then((followUpGroups) => {
                  // create promise queues for handling database operations
                  const dbOpsQueue = FollowupGeneration.dbOperationsQueue(options);

                  let pool = new PromisePool(
                    contacts.map((contact) => {
                      contact.followUpsList = followUpGroups[contact.id] || [];
                      return FollowupGeneration
                        .getContactFollowupEligibleTeams(contact, teams)
                        .then((eligibleTeams) => {
                          contact.eligibleTeams = eligibleTeams;
                        })
                        .then(() => {
                          // it returns a list of follow ups objects to insert and a list of ids to remove
                          let generateResult = FollowupGeneration.generateFollowupsForContact(
                            contact,
                            contact.eligibleTeams,
                            {
                              startDate: followupStartDate,
                              endDate: followupEndDate
                            },
                            outbreakFollowUpFreq,
                            outbreakFollowUpPerDay,
                            targeted
                          );

                          dbOpsQueue.enqueueForInsert(generateResult.add);
                          dbOpsQueue.enqueueForRecreate(generateResult.update);
                        });
                    }),
                    100 // concurrency limit
                  );

                  let poolPromise = pool.start();

                  return poolPromise
                    // make sure the queue has emptied
                    .then(() => dbOpsQueue.internalQueue.onIdle())
                    // settle any remaining items that didn't reach the batch size
                    .then(() => dbOpsQueue.settleRemaining())
                    .then(() => dbOpsQueue.insertedCount());
                })
                .then(count => {
                  // count newly created followups
                  followUpsCount += count;
                });
            };

            return helpers.handleActionsInBatches(
              getActionsCount,
              getBatchData,
              batchItemsAction,
              null,
              1000,
              null,
              options.remotingContext.req.logger
            );
          });
      })
      .then(() => callback(null, {count: followUpsCount}))
      .catch((err) => callback(err));
  };
};
