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
 * @param callback
 */
const setUsualPlaceOfResidenceLocationIdOnFollowUp = (callback) => {
  // create Mongo DB connection
  let followUpCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      followUpCollection = dbConn.collection('followUp');

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count follow-ups
        return followUpCollection
          .countDocuments({});
      };

      const getBatchData = (batchNo, batchSize) => {
        // get follow-ups for batch
        return followUpCollection
          .find({}, {
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
