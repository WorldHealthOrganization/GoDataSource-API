'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

// constants
const personFindBatchSize = 10000;
const personUpdateBatchSize = 50;

/**
 * Update number of exposures and contacts
 */
const updateNumberOfExposuresAndContacts = (callback) => {
  // create Mongo DB connection
  let personCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collections
      personCollection = dbConn.collection('person');
    })

    // force an update of all records
    .then(() => {
      return personCollection
        .updateMany({}, {
          $unset: {
            numberOfContacts: '',
            numberOfExposures: ''
          }
        });
    })

    // determine number of contacts and exposures
    .then(() => {
      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count persons
        return personCollection
          .countDocuments({}, {
            maxTimeMS: 999999
          });
      };

      // batch handler
      const getBatchData = (batchNo, batchSize) => {
        // get persons for batch
        return personCollection
          .find({
            numberOfExposures: {
              $exists: false
            }
          }, {
            limit: batchSize,
            projection: {
              _id: 1,
              relationshipsRepresentation: 1
            }
          })
          .toArray();
      };

      // item action
      const itemAction = (data) => {
        // count exposures and contacts
        const result = Helpers.countPeopleContactsAndExposures(data);

        // update person
        return personCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': {
              numberOfContacts: result.numberOfContacts,
              numberOfExposures: result.numberOfExposures
            }
          });
      };

      // batch handler
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        personFindBatchSize,
        personUpdateBatchSize,
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
  updateNumberOfExposuresAndContacts
};
