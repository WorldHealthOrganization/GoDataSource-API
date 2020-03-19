'use strict';

// deps
const MongoDBHelper = require('../../../components/mongoDBHelper');
const Async = require('async');
const DataSources = require('../../datasources');
const _ = require('lodash');
const Uuid = require('uuid');

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
const now = new Date();
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
      $and: [
        {
          'dateRanges.centerName': {
            $exists: true
          }
        },
        {
          'dateRanges.centerName': {
            $ne: null
          }
        },
        {
          'dateRanges.centerName': {
            $not: /LNG_REFERENCE_DATA/
          }
        },
        {
          deleted: {
            $ne: true
          }
        }
      ]
    }, { projection: { _id: 1, dateRanges: 1 } })
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
          const trimmedCentreName = dateRange.centerName.trim();
          const insensitiveCentreName = trimmedCentreName.toUpperCase();
          if (!centreNames[insensitiveCentreName]) {
            centreNames[insensitiveCentreName] = {
              value: trimmedCentreName,
              id: `${centreNameReferenceDataCategory}_${_.snakeCase(trimmedCentreName).toUpperCase()}`
            };

            const dataId = centreNames[insensitiveCentreName].id;

            referenceDataEntries.push(Object.assign({}, {
              _id: dataId,
              categoryId: 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME',
              value: dataId,
              description: dataId + '_DESCRIPTION',
              readOnly: false,
              active: true,
              deleted: false
            }, authorInfo));

            languageIds.forEach(langId => {
              languageTokensEntries.push(Object.assign({}, {
                _id: generateLanguageTokenID(dataId, langId),
                token: dataId,
                languageId: langId,
                translation: trimmedCentreName
              }, authorInfo));
            });
          }

          dateRange.centerName = centreNames[insensitiveCentreName].id;
        });
      });

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
        .find({ deleted: { $ne: true } }, { projection: { _id: 1 } })
        .toArray()
        .then(languages => {
          languageIds = languages.map(lang => lang._id);

          // start processing records
          executeNextBatch(cb);
        });
    })
    .catch(cb);
};

module.exports = run;
