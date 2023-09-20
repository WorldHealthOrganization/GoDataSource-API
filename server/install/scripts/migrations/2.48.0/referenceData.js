'use strict';

const referenceDataMigrator = require('../../referenceDataMigrator');
const MongoDBHelper = require('../../../../../components/mongoDBHelper');

/**
 * Create / Update default reference data
 */
const createUpdateDefaultReferenceData = (callback) => {
  referenceDataMigrator
    .createUpdateDefaultReferenceData(`${__dirname}/data/reference`)
    .then(() => {
      callback();
    })
    .catch(callback);
};

/**
 * Mark "Other" hospitalization/isolation as non system value
 * @param callback
 */
const updateHospitalizationIsolationType = (callback) => {
  // reference data collection
  let referenceDataCollection;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      referenceDataCollection = dbConn.collection('referenceData');

      // get item
      return referenceDataCollection
        .findOne({
          _id: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE_OTHER',
          categoryId: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE',
          readOnly: true
        },
        {
          projection: {
            _id: 1
          }
        });
    })
    .then(referenceData => {
      if (!referenceData) {
        console.log('The system could not find the "Other" hospitalization/isolation type to be marked as non system value');
        return;
      }

      // mark followup status as disabled
      console.log('The "Other" hospitalization/isolation type will be marked as non system value');
      return referenceDataCollection
        .updateOne({
          _id: referenceData._id
        }, {
          $set: {
            readOnly: false,
            updatedAt: new Date(),
            dbUpdatedAt: new Date()
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
  createUpdateDefaultReferenceData,
  updateHospitalizationIsolationType
};
