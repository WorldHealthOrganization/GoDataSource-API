'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const _ = require('lodash');
const Config = require('../../../../config.json');

// used in setUsualPlaceOfResidenceLocationIdOnFollowUp function
const followUpFindBatchSize = _.get(Config, 'jobSettings.setUsualPlaceOfResidenceLocationIdOnFollowUp.batchSize', 1000);

// set how many person update actions to run in parallel
const followUpUpdateBatchSize = 10;


/**
 * Set usualPlaceOfResidenceLocationId for all follow-ups
 * @param [options] Optional
 * @param [options.outbreakName] Outbreak for which to update required information
 * @param callback
 */
const setUsualPlaceOfResidenceLocationIdOnFollowUp = (options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // create Mongo DB connection
  let outbreakCollection, followUpCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');
      followUpCollection = dbConn.collection('followUp');

      // initialize followUpFilter; updating all follow-ups including deleted
      let followUpFilter = {};

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // depending on given options we might just want to update follow-ups on a given outbreak
        let getOutbreakId = Promise.resolve();
        if (
          options.outbreakName &&
          options.outbreakName.length
        ) {
          getOutbreakId = outbreakCollection
            .findOne({
              name: options.outbreakName
            }, {
              projection: {
                _id: 1
              }
            })
            .then(outbreak => {
              if (!outbreak) {
                return Promise.reject(`Given outbreak ${options.outbreakName} was not found in system`);
              }

              return outbreak._id;
            });
        }

        return getOutbreakId
          .then(outbreakId => {
            // update follow-up filter if needed
            if (outbreakId) {
              followUpFilter.outbreakId = outbreakId;
            }

            // count follow-ups
            return followUpCollection
              .countDocuments(followUpFilter);
          });
      };

      const getBatchData = (batchNo, batchSize) => {
        // get follow-ups for batch
        return followUpCollection
          .find(followUpFilter, {
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              address: 1
            }
          })
          .toArray();
      };

      const itemAction = (data) => {
        // get locationId from usual place of residence address
        let usualPlaceOfResidenceLocationId = data.address && data.address.locationId ?
          data.address.locationId :
          null;

        // update follow-up
        return followUpCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': {
              usualPlaceOfResidenceLocationId: usualPlaceOfResidenceLocationId
            }
          });
      };

      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        followUpFindBatchSize,
        followUpUpdateBatchSize,
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
  setUsualPlaceOfResidenceLocationIdOnFollowUp
};
