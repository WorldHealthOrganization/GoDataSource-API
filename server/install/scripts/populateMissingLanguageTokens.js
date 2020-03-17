'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const _ = require('lodash');
const uuid = require('uuid');
const async = require('async');
const datasources = require('../../datasources');
const common = require('./_common');

// main language used to fill out missing tokens for all other languages
const mainLanguageId = 'english_us';
const recordsPerRequest = 1000;

/**
 * Get all languages that we need to check for missing token fom database
 */
function getLanguages(data) {
  console.log('Retrieving all languages...');
  return data.mongoDBConnection
    .collection('language')
    .find({
      _id: {
        $ne: mainLanguageId
      },
      deleted: {
        $ne: true
      }
    }, {
      _id: 1,
      name: 1
    })
    .toArray()
    .then((languages) => {
      console.log('Retrieved all languages');
      return {
        mongoDBConnection: data.mongoDBConnection,
        languages: languages || []
      };
    });
}

/**
 * Retrieve language tokens for which we need to check if they are missing
 */
function getMainLanguageTokens(
  data,
  useDataCallback
) {
  // nothing to do ?
  if (data.languages.length < 1) {
    // log
    console.log('There is no language to update...');
    return;
  }

  // log
  console.log(`Retrieving '${mainLanguageId}' tokens...`);

  // retrieve data page by page so we don't use too much memory.. :)
  let offset = 0;
  const retrieveNextPage = () => {
    console.log(`Retrieving tokens ${offset + 1} to ${offset + recordsPerRequest}`);
    return data.mongoDBConnection
      .collection('languageToken')
      .find({
        languageId: mainLanguageId,
        deleted: {
          $ne: true
        }
      }, {
        _id: 1,
        token: 1,
        translation: 1,
        outbreakId: 1,
        modules: 1
      })
      .skip(offset)
      .limit(recordsPerRequest)
      .toArray();
  };

  // create Promise so we know when everything finished
  return new Promise(function (resolve, reject) {
    // retrieve data
    const languagesIds = (data.languages || []).map((language) => language._id);
    const nextPage = () => {
      retrieveNextPage()
        .then((records) => {
          // nothing to do anymore ?
          if (
            !records ||
            records.length < 1
          ) {
            return resolve();
          }

          // wait for data to be used before retrieving a new page
          useDataCallback(
            {
              mongoDBConnection: data.mongoDBConnection,
              languagesIds: languagesIds,
              records: records || []
            },
            (offset / recordsPerRequest) + 1,
            (err) => {
              // an error occurred ?
              if (err) {
                return reject(err);
              }

              // next page
              offset += recordsPerRequest;
              nextPage();
            }
          );
        })
        .catch(reject);
    };

    // first page
    nextPage();
  });
}

/**
 * Determine missing language tokens for all other languages compared to main language
 */
function determineMissingLanguageTokens(
  data,
  pageNo,
  finishedCallback
) {
  // determine missing tokens
  console.log(`Determining missing tokens ( page: ${pageNo} )`);

  // map tokens so we know what we need to check
  const mappedRecords = {};
  data.records.forEach((tokenData) => {
    mappedRecords[tokenData.token] = tokenData;
  });

  // generate token id
  const generateTokenID = function (token, languageId) {
    // id can have at most 1024 chars
    if (token.length > 900) {
      // make token smaller (and make sure its unique)
      token = `${token.substring(0, 100)}_${_.snakeCase(uuid.v4().toUpperCase())}`;
    }
    return `${token}_${_.snakeCase(languageId).toUpperCase()}`;
  };

  // create list of tokens to check in other languages
  // & determine missing tokens
  const languageToken = data.mongoDBConnection.collection('languageToken');
  const tokens = Object.keys(mappedRecords);
  data.mongoDBConnection
    .collection('languageToken')
    .find({
      languageId: {
        $in: data.languagesIds
      },
      token: {
        $in: tokens
      }
    }, {
      _id: 1,
      languageId: 1,
      token: 1,
      outbreakId: 1,
      modules: 1
    })
    .toArray()
    .then((tokensToCheck) => {
      // prepare languages for token map
      const tokensToCheckMap = {};
      data.languagesIds.forEach((langId) => {
        tokensToCheckMap[langId] = {};
      });

      // map tokens by language and token
      (tokensToCheck || []).forEach((tokenData) => {
        tokensToCheckMap[tokenData.languageId][tokenData.token] = tokenData;
      });

      // compare and determine if we need to create or update records
      const jobs = [];
      data.languagesIds.forEach((languageToCheckId) => {
        data.records.forEach((mainLanguageTokenData) => {
          // create ?
          if (tokensToCheckMap[languageToCheckId][mainLanguageTokenData.token] === undefined) {
            // create token
            jobs.push((function (localMainLanguageTokenData, localLanguageToCheckId) { return (callback) => {
              // generate id
              const tokenID = localMainLanguageTokenData._id.startsWith('LNG_') ?
                generateTokenID(localMainLanguageTokenData.token, localLanguageToCheckId) :
                uuid();

              // prepare object to save
              const newTokenData = Object.assign({
                _id: tokenID,
                languageId: localLanguageToCheckId,
                token: localMainLanguageTokenData.token,
                outbreakId: localMainLanguageTokenData.outbreakId,
                modules: localMainLanguageTokenData.modules,
                translation: localMainLanguageTokenData.translation
              }, common.install.timestamps);

              // create
              languageToken
                .insertOne(newTokenData)
                .then(() => {
                  // log
                  console.log(`Token '${newTokenData._id}' created`);

                  // finished
                  callback();
                })
                .catch(callback);
            }; })(mainLanguageTokenData, languageToCheckId));
          } else {
            // update
            // check if anything is different
            if (
              (
                mainLanguageTokenData.outbreakId ||
                mainLanguageTokenData.modules
              ) && (
                mainLanguageTokenData.outbreakId !== tokensToCheckMap[languageToCheckId][mainLanguageTokenData.token].outbreakId ||
                !_.isEqual(mainLanguageTokenData.modules, tokensToCheckMap[languageToCheckId][mainLanguageTokenData.token].modules)
              )
            ) {
              // update token
              jobs.push((function (_id, localMainLanguageTokenData) { return (callback) => {
                languageToken
                  .updateOne({
                    _id: _id
                  }, {
                    '$set': {
                      outbreakId: localMainLanguageTokenData.outbreakId,
                      modules: localMainLanguageTokenData.modules
                    }
                  })
                  .then(() => {
                    // log
                    console.log(`Token '${_id}' updated`);

                    // finished
                    callback();
                  })
                  .catch(callback);
              }; })(tokensToCheckMap[languageToCheckId][mainLanguageTokenData.token]._id, mainLanguageTokenData));
            }
          }
        });
      });

      // wait for all operations to be done
      if (jobs.length > 0) {
        async.parallelLimit(jobs, 10, function (error) {
          // an error occurred
          if (error) {
            return finishedCallback(error);
          }

          // finished - go to next page
          console.log(`Determined missing tokens ( page: ${pageNo} )`);
          finishedCallback();
        });
      } else {
        // next page
        console.log('Nothing to change');
        finishedCallback();
      }
    })
    .catch(finishedCallback);
}

/**
 * Run initiation
 */
function run(callback) {
  // create Mongo DB connection
  MongoDBHelper
    .getMongoDBConnection({
      ignoreUndefined: datasources.mongoDb.ignoreUndefined
    })
    .then((mongoDBConnection) => {
      // retrieve current languages
      return getLanguages({
        mongoDBConnection
      });
    })
    .then((data) => {
      // retrieve main language tokens
      // determine what tokens are missing for each language
      return getMainLanguageTokens(
        data,
        determineMissingLanguageTokens
      );
    })
    .then(() => {
      // finished
      console.log('Finished populating languages with missing tokens');
      callback();
    })
    .catch(callback);
}

module.exports = run;
