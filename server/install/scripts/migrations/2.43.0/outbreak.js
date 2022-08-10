'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Remove private properties from db (_countryIds & _countries)
 */
const cleanUnnecessaryData = (callback) => {
  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      return dbConn.collection('outbreak')
        .updateMany({}, {
          '$unset': {
            _countryIds: '',
            _countries: ''
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
  cleanUnnecessaryData
};
