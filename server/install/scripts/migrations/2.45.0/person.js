'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');

/**
 * Delete relationships, lab results and follow-ups related to persons that are deleted
 */
const deleteRelatedDataIfPersonDeleted = (callback) => {
  let personCollection, labResultCollection, followUpCollection, relationshipsCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      // collections
      personCollection = dbConn.collection('person');
      labResultCollection = dbConn.collection('labResult');
      followUpCollection = dbConn.collection('followUp');
      relationshipsCollection = dbConn.collection('relationship');

      // initialize parameters for handleActionsInBatches call
      const personQuery = {
        deleted: true
      };
      const getActionsCount = () => {
        // count persons
        return personCollection
          .countDocuments(personQuery);
      };

      const getBatchData = (batchNo, batchSize) => {
        // get persons for batch
        return personCollection
          .find(personQuery, {
            skip: (batchNo - 1) * batchSize,
            limit: batchSize,
            sort: {
              createdAt: 1
            },
            projection: {
              _id: 1,
              deletedAt: 1
            }
          })
          .toArray();
      };

      const itemAction = (data) => {
        // delete unused lab results
        return labResultCollection
          .updateMany({
            deleted: false,
            personId: data._id
          }, {
            '$set': {
              deleted: true,
              deletedAt: data.deletedAt,
              deletedByParent: data._id
            }
          })
          .then(() => {
            // delete unused follow-ups
            return followUpCollection
              .updateMany({
                deleted: false,
                personId: data._id
              }, {
                '$set': {
                  deleted: true,
                  deletedAt: data.deletedAt,
                  deletedByParent: data._id
                }
              });
          })
          .then(() => {
            // delete unused relationships
            // - if both persons were deleted, the first one is the lucky deletedByParent
            return relationshipsCollection
              .updateMany({
                deleted: false,
                'persons.id': data._id
              }, {
                '$set': {
                  deleted: true,
                  deletedAt: data.deletedAt,
                  deletedByParent: data._id
                }
              });
          });
      };

      // execute
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        1000,
        1,
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
  deleteRelatedDataIfPersonDeleted
};
