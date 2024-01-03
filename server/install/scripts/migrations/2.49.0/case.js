'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const localizationHelper = require('../../../../../components/localizationHelper');
const _ = require('lodash');

// Number of find requests at the same time
// Don't set this value to high, so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Update follow-up data for all cases
 */
const updateFollowUpData = (callback) => {
  // collections
  let outbreakCollection, personCollection;

  // create map of ID to outbreak information
  let outbreaksMap = {};

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');
      personCollection = dbConn.collection('person');
    })
    .then(() => {
      return outbreakCollection
        .find({
          deleted: false
        }, {
          projection: {
            _id: 1,
            generateFollowUpsDateOfOnset: 1,
            periodOfFollowupCases: 1
          }
        })
        .toArray();
    })
    .then((outbreaks) => {
      // return if no outbreak found
      if (outbreaks.length === 0) {
        return;
      }

      // map outbreaks
      outbreaks.forEach(outbreak => {
        outbreaksMap[outbreak._id] = outbreak;
      });

      // initialize parameters for handleActionsInBatches call
      const personQuery = {
        outbreakId: {
          $in: Object.keys(outbreaksMap)
        },
        type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count records that we need to update
        return personCollection
          .countDocuments(personQuery);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        return personCollection
          .find(personQuery, {
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              _id: 1,
              outbreakId: 1,
              dateOfOnset: 1,
              followUp : 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // get outbreak
        const outbreak = outbreaksMap[data.outbreakId];

        // keep a flag for updating case
        let shouldUpdate = false;

        // build a list of properties that need to be updated
        // & preserve previous value
        const previousStatusValue = _.get(data.followUp, 'status');
        const propsToUpdate = {
          status: previousStatusValue ?
            previousStatusValue :
            'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'
        };

        // preserve original startDate, if any
        if (
          data.followUp &&
          data.followUp.originalStartDate
        ) {
          propsToUpdate.originalStartDate = data.followUp.originalStartDate;
        }

        // update startDate and endDate if only dateOfOnset is set
        // otherwise, remove them
        if (!data.dateOfOnset) {
          shouldUpdate = true;
        } else {
          // set follow-up start date to be the date of onset
          // check also if case tracing should start on the date of onset
          propsToUpdate.startDate = outbreak.generateFollowUpsDateOfOnset ?
            localizationHelper.getDateStartOfDay(data.dateOfOnset) :
            localizationHelper.getDateStartOfDay(data.dateOfOnset).add(1, 'days');

          // if follow-up original start date was not previously set
          if (!propsToUpdate.originalStartDate) {
            // flag as an update
            shouldUpdate = true;
            // set it as follow-up start date
            propsToUpdate.originalStartDate = localizationHelper.getDateStartOfDay(propsToUpdate.startDate);
          }

          // set follow-up end date
          propsToUpdate.endDate = localizationHelper.getDateStartOfDay(propsToUpdate.startDate).add(outbreak.periodOfFollowupCases - 1, 'days');

          // set generateFollowUpsDateOfOnset if only the outbreak feature is enabled
          if (outbreak.generateFollowUpsDateOfOnset) {
            propsToUpdate.generateFollowUpsDateOfOnset = true;
          }

          // check if case instance should be updated (check if any property changed value)
          !shouldUpdate && ['startDate', 'endDate']
            .forEach(function (updatePropName) {
              // if the property is missing (probably never, but lets be safe)
              if (!data.followUp) {
                // flag as an update
                return shouldUpdate = true;
              }

              // if either original or new value was not set (when the other was present)
              if (
                (
                  !data.followUp[updatePropName] &&
                  propsToUpdate[updatePropName]
                ) || (
                  data.followUp[updatePropName] &&
                  !propsToUpdate[updatePropName]
                )
              ) {
                // flag as an update
                return shouldUpdate = true;
              }
              // both original and new values are present, but the new values are different than the old ones
              if (
                data.followUp[updatePropName] &&
                propsToUpdate[updatePropName] &&
                (localizationHelper.toMoment(data.followUp[updatePropName]).toDate().getTime() !== localizationHelper.toMoment(propsToUpdate[updatePropName]).toDate().getTime())
              ) {
                // flag as an update
                return shouldUpdate = true;
              }
            });

          // convert dates to string
          propsToUpdate.originalStartDate = localizationHelper.toMoment(propsToUpdate.originalStartDate).toDate();
          propsToUpdate.startDate = localizationHelper.toMoment(propsToUpdate.startDate).toDate();
          propsToUpdate.endDate = localizationHelper.toMoment(propsToUpdate.endDate).toDate();
        }

        // if dates are the same, but there is no previous status set, we may need to set the default status
        // this case might occur during import
        if (!shouldUpdate && !previousStatusValue) {
          shouldUpdate = true;
        }

        // updates are required ?
        if (!shouldUpdate) {
          return Promise.resolve();
        }

        // update
        return personCollection
          .updateOne({
            _id: data._id
          }, {
            $set: {
              followUp: propsToUpdate,
              // case is active if there is no dateOfOnset or it has valid follow-up interval
              active: !data.dateOfOnset || !!propsToUpdate.startDate
            }
          });
      };

      // execute jobs in batches
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        findBatchSize,
        updateBatchSize,
        console
      );
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  updateFollowUpData
};
