'use strict';

// deps
const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Async = require('async');
const DataSources = require('../../../../datasources');
const _ = require('lodash');
const Uuid = require('uuid');
const localizationHelper = require('../../../../../components/localizationHelper');

// taken from language token model
// doing this to not start the whole app
const generateLanguageTokenID = function (token, languageId) {
  // id can have at most 1024 chars
  if (token.length > 900) {
    // make token smaller (and make sure its unique)
    token = `${token.substring(0, 100)}_${_.snakeCase(Uuid.v4().toUpperCase())}`;
  }
  return `${token}_${_.snakeCase(languageId).toUpperCase()}`;
};

// number of records processed at once
const batchSize = 1000;

// common fields
const centreNameReferenceDataCategory = 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME';
const now = localizationHelper.now().toDate();
const authorInfo = {
  createdBy: 'system',
  updatedBy: 'system',
  createdAt: now,
  updatedAt: now
};

// db collection references
let referenceDataCollection = null;
let languageTokenCollection = null;
let personCollection = null;

// language ids reference
let languageIds = [];

// database connection reference
let mongoDBConnection = null;

// contains unique centre name entries
// that will be created as reference data in database
const centreNames = {};

// process next batch of items
const executeNextBatch = function (cb) {
  mongoDBConnection
    .collection('person')
    .find({
      dateRanges: {
        $elemMatch: {
          centerName: {
            $exists: true,
            $ne: null,
            $not: /^LNG_REFERENCE_DATA/
          }
        }
      }
    }, {projection: {_id: 1, dateRanges: 1}})
    .limit(batchSize)
    .toArray()
    .then(records => {
      if (!records || records.length === 0) {
        return cb();
      }

      // ready to insert into database entries of reference data and corresponding language tokens
      let referenceDataEntries = [];
      let languageTokensEntries = [];

      records.forEach(record => {
        record.dateRanges.forEach(dateRange => {
          // jump over empty center names
          if (!dateRange.centerName) {
            dateRange.centerName = dateRange.centerName || null;
            return;
          }

          // determine center name
          // jump over if there is nothing to change ir if this item was already changed
          const trimmedCentreName = dateRange.centerName.trim();
          if (
            !trimmedCentreName ||
            trimmedCentreName.startsWith('LNG_REFERENCE_DATA')
          ) {
            dateRange.centerName = trimmedCentreName || null;
            return;
          }

          // determine unique id to check if center name was created already
          const insensitiveCentreName = `${centreNameReferenceDataCategory}_${_.snakeCase(trimmedCentreName).toUpperCase()}`.toUpperCase();
          if (!centreNames[insensitiveCentreName]) {
            centreNames[insensitiveCentreName] = {
              value: trimmedCentreName,
              id: `${centreNameReferenceDataCategory}_${_.snakeCase(trimmedCentreName).toUpperCase()}`
            };

            const dataId = centreNames[insensitiveCentreName].id;
            console.log(`Creating ref data '${dataId}'`);
            referenceDataEntries.push(Object.assign({}, {
              _id: dataId,
              categoryId: centreNameReferenceDataCategory,
              value: dataId,
              description: dataId + '_DESCRIPTION',
              readOnly: false,
              active: true,
              deleted: false
            }, authorInfo));

            // create tokens for each language
            languageIds.forEach(langId => {
              // create centre name token
              const langTokenId = generateLanguageTokenID(dataId, langId);
              console.log(`Creating lang token '${langTokenId}'`);
              languageTokensEntries.push(Object.assign({}, {
                _id: langTokenId,
                token: dataId,
                tokenSortKey: dataId.substr(0, 128),
                languageId: langId,
                translation: trimmedCentreName
              }, authorInfo));

              // create centre name description token
              languageTokensEntries.push(Object.assign({}, {
                _id: generateLanguageTokenID(`${dataId}_DESCRIPTION`, langId),
                token: `${dataId}_DESCRIPTION`,
                tokenSortKey: `${dataId}_DESCRIPTION`.substr(0, 128),
                languageId: langId,
                translation: ''
              }, authorInfo));
            });
          }

          // update center names
          dateRange.centerName = centreNames[insensitiveCentreName].id;
        });
      });

      // run jobs
      let promiseOps = [];
      if (referenceDataEntries.length) {
        promiseOps.push(referenceDataCollection.insertMany(referenceDataEntries));
      }
      if (languageTokensEntries.length) {
        promiseOps.push(languageTokenCollection.insertMany(languageTokensEntries));
      }

      // insert reference data entries/translations into database
      return Promise.all(promiseOps).then(() => {
        referenceDataEntries = [];
        languageTokensEntries = [];

        Async.parallelLimit(records.map(entry => {
          return (cb) => {
            console.log(`Updating person '${entry._id}' dateRanges`);
            personCollection.updateOne(
              {
                _id: entry._id
              },
              {
                $set: {
                  dateRanges: entry.dateRanges
                }
              },
              (err) => {
                if (err) {
                  return cb(err);
                }
                return cb();
              });
          };
        }), 50, (err) => {
          if (err) {
            return cb(err);
          }
          executeNextBatch(cb);
        });
      });
    });
};

// script's entry point
const run = function (cb) {
  // create Mongo DB connection
  MongoDBHelper
    .getMongoDBConnection({
      ignoreUndefined: DataSources.mongoDb.ignoreUndefined
    })
    .then(dbConn => {
      mongoDBConnection = dbConn;

      referenceDataCollection = dbConn.collection('referenceData');
      languageTokenCollection = dbConn.collection('languageToken');
      personCollection = dbConn.collection('person');

      // get system's languages
      dbConn
        .collection('language')
        .find({deleted: false}, {projection: {_id: 1}})
        .toArray()
        .then(languages => {
          languageIds = languages.map(lang => lang._id);
        })
        .then(() => {
          return referenceDataCollection
            .find({
              categoryId: centreNameReferenceDataCategory
            }, {projection: {_id: 1, value: 1}})
            .toArray();
        })
        .then((existingCenterNames) => {
          // populate existing center names
          (existingCenterNames || []).forEach((center) => {
            centreNames[center.value.toUpperCase()] = {
              value: center.value,
              id: center._id
            };
          });

          // start processing records
          executeNextBatch(() => {
            // finished
            console.log('Finished migrating center names');
            cb();
          });
        });
    })
    .catch(cb);
};

module.exports = {
  run
};
