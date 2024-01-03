'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Rename lastLoginDate to bruteForceLoginDate
 */
const renameLastLoginDate = (callback) => {
  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // rename
      return dbConn.collection('user')
        .updateMany({}, {
          $rename: {
            lastLoginDate: 'bruteForceLoginDate'
          }
        });
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  renameLastLoginDate
};
