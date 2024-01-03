'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const localizationHelper = require('../../../../../components/localizationHelper');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

/**
 * Delete the future follow-ups for cases and contacts of contacts
 */
const deleteFutureFollowups = (callback) => {
  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collections
      const followUpCollection = dbConn.collection('followUp');

      // do until we have no follow-ups
      const deleteFollowups = () => {
        // get all follow-ups starting from tomorrow
        return followUpCollection
          .aggregate([
            {
              $lookup: {
                from: 'person',
                localField: 'personId',
                foreignField: '_id',
                as: 'persons'
              }
            },
            {
              $match: {
                date: {
                  $gte: localizationHelper.today().add(1, 'days').toDate()
                },
                deleted: false,
                'persons.type': {
                  $in: [
                    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
                  ]
                }
              }
            },
            {
              $limit: findBatchSize
            },
            {
              $project: {
                _id: 1
              }
            }
          ], {
            allowDiskUse: true
          })
          .toArray()
          .then((followUps) => {
            // no follow-ups to delete ?
            if (followUps.length < 1) {
              return Promise.resolve();
            }

            // mark follow-ups as deleted
            return followUpCollection
              .updateMany(
                {
                  _id: {
                    $in: followUps.map(followUp => followUp._id)
                  }
                },
                {
                  '$set': {
                    deleted: true,
                    deletedAt: localizationHelper.now().toDate(),
                    updatedAt: localizationHelper.now().toDate(),
                    dbUpdatedAt: localizationHelper.now().toDate()
                  }
                }
              )
              .then(() => deleteFollowups());
          });
      };

      // do until we have no follow-ups
      return deleteFollowups();
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Update Created As with "contact" person type
 */
const setCreatedAs = (callback) => {
  // create Mongo DB connection
  let followUpCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collection
      followUpCollection = dbConn.collection('followUp');
    })

    // force an update of all records
    .then(() => {
      return followUpCollection
        .updateMany({}, {
          $set: {
            createdAs: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
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
  deleteFutureFollowups,
  setCreatedAs
};
