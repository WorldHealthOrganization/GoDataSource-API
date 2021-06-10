'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const _ = require('lodash');
const Config = require('../../../../config.json');

// constants
const personFindBatchSize = _.get(Config, 'jobSettings.updateMissingDuplicateKeys.batchSize', 10000);
const personUpdateBatchSize = _.get(Config, 'jobSettings.updateMissingDuplicateKeys.updateBatchSize', 50);

/**
 * Update duplicate keys used to easily find duplicates
 */
const updateMissingDuplicateKeys = (callback) => {
  // create Mongo DB connection
  let personCollection;
  return MongoDBHelper
    .getMongoDBConnection({
      connectTimeoutMS: 9999999,
      socketTimeoutMS: 9999999
    })
    .then(dbConn => {
      personCollection = dbConn.collection('person');

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count persons
        return personCollection
          .countDocuments({
            type: {
              $in: [
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
              ]
            },
            duplicateKeys: {
              $exists: false
            }
          }, {
            maxTimeMS: 999999
          });
      };

      const getBatchData = (batchNo, batchSize) => {
        // get persons for batch
        return personCollection
          .find({
            type: {
              $in: [
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
              ]
            },
            duplicateKeys: {
              $exists: false
            }
          }, {
            limit: batchSize,
            projection: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              middleName: 1,
              documents: 1
            }
          })
          .toArray();
      };

      const itemAction = (data) => {
        // first, last, middle names
        const target = {};
        Helpers.attachDuplicateKeys(
          target,
          data,
          'name',
          [
            ['firstName', 'lastName'],
            ['firstName', 'middleName'],
            ['lastName', 'middleName']
          ]
        );

        // attach documents
        Helpers.attachDuplicateKeys(
          target,
          data,
          'document',
          [
            ['type', 'number']
          ],
          'documents'
        );

        // we need to put something even if no duplicate keys should exist
        if (
          !target.duplicateKeys ||
          _.isEmpty(target.duplicateKeys)
        ) {
          target.duplicateKeys = {};
        }

        // update person
        return personCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': target
          });
      };

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
  updateMissingDuplicateKeys
};
