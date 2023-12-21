'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const localizationHelper = require('../../../../../components/localizationHelper');
const uuid = require('uuid');

/**
 * Move client applications from system settings to clientApplication collection
 */
const migrateClientApplications = (callback) => {
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      // collections
      const systemSettings = dbConn.collection('systemSettings');
      const clientApplication = dbConn.collection('clientApplication');
      let clientApplicationsModels;

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count persons
        return systemSettings
          .findOne()
          .then((settings) => {
            // set data
            clientApplicationsModels = settings && settings.clientApplications ?
              settings.clientApplications :
              [];

            // return number of models to process
            return clientApplicationsModels.length;
          });
      };

      // get records in batches
      const getBatchData = () => {
        // get all records since we already have everything in memory
        return Promise.resolve()
          .then(() => {
            return clientApplicationsModels;
          });
      };

      // create client applications
      const now = localizationHelper.now().toDate();
      const itemAction = (data) => {
        // invalid ?
        if (
          !data ||
          !data.credentials ||
          !data.credentials.clientId ||
          !data.credentials.clientSecret
        ) {
          return Promise.resolve;
        }

        // log
        console.log(`Creating client application "${data.name}"`);

        // set id
        data._id = data.id || uuid.v4();
        delete data.id;

        // set create, update, deleted, dbUpdate... fields
        data.deleted = false;
        data.createdAt = now;
        data.createdBy = 'system';
        data.updatedAt = now;
        data.updatedBy = 'system';
        data.dbUpdatedAt = now;

        // insert
        return clientApplication
          .findOne({
            _id: data._id
          })
          .then((item) => {
            // conflict ?
            if (item) {
              // same ?
              if (
                item.credentials &&
                data.credentials &&
                item.credentials.clientId === data.credentials.clientId &&
                item.credentials.clientSecret === data.credentials.clientSecret
              ) {
                // nothing to do, same client application, we consider that all data is configured properly
                console.log(`No need to create client application "${data.name}"`);

                // finished
                return;
              }

              // conflict - replace id
              data._id = uuid.v4();

              // log
              console.log(`Conflict found for client application "${data.name}"`);
            }

            // create
            return clientApplication.insertOne(data);
          });
      };

      // execute
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        50000,
        10,
        console
      ).then(() => {
        // remove client applications from system settings
        // - only one exists in db so no need to set filter
        return systemSettings.updateOne(
          {},
          {
            $unset: {
              clientApplications: ''
            }
          }
        );
      });
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  migrateClientApplications
};
