'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const DataSources = require('../../datasources.json');

const adminEmailConfig = require('../../config.json').adminEmail;
const ADMIN_ID = 'sys_admin';
const ADMIN_EMAIL = adminEmailConfig || 'admin@who.int';

// !IMPORTANT
// this script should always run and not be logged into migrate logs followed by not being run after that

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // create Mongo DB connection
  let userCollection;
  return MongoDBHelper
    .getMongoDBConnection({
      ignoreUndefined: DataSources.mongoDb.ignoreUndefined
    })
    .then(dbConn => {
      // user collection
      userCollection = dbConn.collection('user');

      // retrieve admin user
      return userCollection
        .find({
          $or: [
            {
              email: {
                $in: [
                  ADMIN_EMAIL,
                  'admin@who.int'
                ]
              }
            } , {
              _id: ADMIN_ID
            }
          ]
        })
        .toArray();
    })
    .then((users) => {
      // error - found multiple matching users with same admin credentials ?
      if (users.length > 1) {
        console.log(`Multiple admin accounts found (id: "${ADMIN_ID}", email1: "${ADMIN_EMAIL}", email2: "admin@who.int"). Probably config.json isn't configured properly`);
        return callback('Multiple admin accounts found');
      }

      // no admin account found ?
      if (users.length < 1) {
        console.log('Admin account not found');
        return callback('Admin account not found');
      }

      // nothing to do ?
      const userData = users[0];
      if (userData.email === ADMIN_EMAIL) {
        return callback();
      }

      // need to update email
      return userCollection
        .updateOne({
          _id: userData._id
        }, {
          '$set': {
            email: ADMIN_EMAIL
          }
        });
    })
    .then(() => {
      callback();
    })
    .catch(callback);
}

// export
module.exports = run;
