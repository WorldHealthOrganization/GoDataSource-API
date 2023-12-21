'use strict';

const app = require('../../../../server');
const uuid = require('uuid');

/**
 * Migrate system settings
 * @param next
 */
const migrateSystemSettings = function (next) {
  const db = app.dataSources.mongoDb.connector;
  return db.connect(() => {
    const collection = db.collection('systemSettings');
    return collection.findOne()
      .then((instance) => {
        if (
          instance &&
          instance.clientApplications
        ) {
          // get through system settings client apps
          // make sure each client has an id
          let clientApplicationsChanged = false;
          instance.clientApplications = (instance.clientApplications || []).map(app => {
            const id = app.id || uuid.v4();
            if (app.id !== id) {
              app.id = id;
              clientApplicationsChanged = true;
            }
            return app;
          });

          if (!clientApplicationsChanged) {
            next();
          } else {
            return collection
              .updateOne({_id: instance.id}, {
                $set: {
                  clientApplications: instance.clientApplications
                }
              })
              .then(() => {
                next();
              })
              .catch(next);
          }
        } else {
          next();
        }
      });
  });
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  migrateSystemSettings
};
