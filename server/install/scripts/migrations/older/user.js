'use strict';

const app = require('../../../../server');
const Async = require('async');
const adminEmailConfig = require('../../../../config.json').adminEmail;
/**
 * Migrate users
 * @param next
 */
const migrateUsers = function (next) {
  const db = app.dataSources.mongoDb.connector;
  return db.connect(() => {
    // sys admin constants
    const ADMIN_ID = 'sys_admin';
    const ADMIN_EMAIL = adminEmailConfig || 'admin@who.int';

    // db collections
    const collections = [
      'helpItem',
      'labResult',
      'databaseActionLog',
      'followUp',
      'user',
      'accessToken',
      'relationship',
      'fileAttachment',
      'helpCategory',
      'deviceHistory',
      'location',
      'filterMapping',
      'language',
      'device',
      'referenceData',
      'team',
      'outbreak',
      'cluster',
      'importMapping',
      'auditLog',
      'person',
      'languageToken',
      'systemSettings',
      'template',
      'backup',
      'role',
      'icon'
    ];

    // make sure we have a sys admin on the system that doesn't have the hardcoded _id
    // we find it by the hardcoded email address admin@who.int
    const userCollection = db.collection('user');
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
          }, {
            _id: ADMIN_ID
          }
        ]
      })
      .toArray()
      .then((results) => {
        // error - found multiple matching users with same admin credentials ?
        if (results.length > 1) {
          app.logger.error(`Multiple admin accounts found (id: "${ADMIN_ID}", email1: "${ADMIN_EMAIL}", email2: "admin@who.int"). Probably config.json isn't configured properly`);
          return next(app.utils.apiError.getError('ADMIN_ACCOUNT_CONFLICT'));
        }

        // everything is alright, just stop the script
        if (results.length < 1) {
          return next();
        }

        // check if we need to update anything
        const result = results[0];
        if (result._id === ADMIN_ID) {
          return next();
        }

        // async jobs ran against database
        const updateJobs = [];

        // used to update createdBy, updateBy fields
        const updateAuthorField = function (collectionName, field, callback) {
          return db.collection(collectionName).updateMany(
            {
              [field]: result._id
            },
            {
              $set: {
                [field]: ADMIN_ID
              }
            },
            err => callback(err)
          );
        };

        // update user's id
        updateJobs.push(
          callback => Async.series([
            callback => userCollection.deleteOne({_id: result._id}, err => callback(err)),
            callback => userCollection.insertOne(
              Object.assign(
                {},
                result, {
                  _id: ADMIN_ID,
                  oldId: result._id
                }),
              err => callback(err)
            )
          ], err => callback(err))
        );

        // go through each collection and update author information
        for (let collectionName of collections) {
          updateJobs.push((callback) => {
            return Async.series([
              callback => updateAuthorField(collectionName, 'createdBy', callback),
              callback => updateAuthorField(collectionName, 'updatedBy', callback)
            ], callback);
          });
        }

        // also find all teams where sys admin is a participant
        // update those as well
        updateJobs.push((callback) => {
          return db.collection('team').updateMany(
            {
              userIds: result._id
            },
            {
              $set: {
                'userIds.$': ADMIN_ID
              }
            },
            err => callback(err)
          );
        });

        return Async.series(updateJobs, err => next(err));
      })
      .catch((err) => {
        return next(err);
      });
  });
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  migrateUsers
};
