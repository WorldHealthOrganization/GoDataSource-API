'use strict';

const app = require('../../server');
const _ = require('lodash');
const async = require('async');

const languageJSON = require(`./../../config/languages/english_us`);

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // retrieve collection name
  const getCollectionName = (Model) => {
    // get collection name from settings (if defined)
    let collectionName = _.get(Model, 'definition.settings.mongodb.collection');

    // if collection name was not defined in settings
    if (!collectionName) {
      // get it from model name
      collectionName = Model.modelName;
    }

    // finished
    return collectionName;
  };

  // db collections that we don't need to check for tokens
  const languageTokensCollectiion = getCollectionName(app.models.languageToken);
  const ignoreCollections = [
    languageTokensCollectiion,
    getCollectionName(app.models.AccessToken),
    getCollectionName(app.models.User),
    getCollectionName(app.models.ACL),
    getCollectionName(app.models.Role),
    getCollectionName(app.models.auditLog),
    getCollectionName(app.models.systemSettings),
    getCollectionName(app.models.databaseActionLog),
    getCollectionName(app.models.syncLog),
    getCollectionName(app.models.databaseExportLog),
    getCollectionName(app.models.address),
    getCollectionName(app.models.Email),
    getCollectionName(app.models.language),
    getCollectionName(app.models.log),
    getCollectionName(app.models.securityQuestion),
    getCollectionName(app.models.importableFile),
    getCollectionName(app.models.sync),
    getCollectionName(app.models.backup),
    getCollectionName(app.models.maps),
    getCollectionName(app.models.fileAttachment),
    getCollectionName(app.models.device),
    getCollectionName(app.models.deviceHistory),
    getCollectionName(app.models.importMapping),
    getCollectionName(app.models.filterMapping),
  ];

  // go through each model and determine which collection should be checked for tokens...
  const collectionToCheck = {};
  app.models().forEach(function (Model) {
    // ignore specific collections
    const collectionName = getCollectionName(Model);
    if (
      !Model.dataSource ||
      ignoreCollections.includes(collectionName)
    ) {
      return;
    }

    // add collection to list
    collectionToCheck[collectionName] = Model;
  });

  // map used tokens for easy find
  const usedTokens = {};

  // add default tokens that are always mandatory
  Object.keys(languageJSON.sections || []).forEach((section) => {
    Object.keys(languageJSON.sections[section]).forEach((token) => {
      usedTokens[token] = 1;
    });
  });

  // if value is a token then add it to existing tokens list
  const checkStringForToken = (stringData) => {
    if (
      stringData &&
      _.isString(stringData) &&
      stringData.startsWith('LNG_') &&
      usedTokens[stringData] === undefined
    ) {
      usedTokens[stringData] = 1;
    }
  };

  // check if array contains any data with tokens
  const checkArrayForTokens = (arrayData) => {
    if (_.isArray(arrayData)) {
      (arrayData || []).forEach((value) => {
        // take action accordingly to its value type
        if (_.isArray(value)) {
          checkArrayForTokens(value);
        } else if (_.isObject(value)) {
          checkObjectForTokens(value);
        } else {
          checkStringForToken(value);
        }
      });
    }
  };

  // check if object contains any data with tokens
  const checkObjectForTokens = (objectData) => {
    if (_.isObject(objectData)) {
      _.each(objectData, (value) => {
        // take action accordingly to its value type
        if (_.isArray(value)) {
          checkArrayForTokens(value);
        } else if (_.isObject(value)) {
          checkObjectForTokens(value);
        } else {
          checkStringForToken(value);
        }
      });
    }
  };

  // determine which tokens are used for each collection
  const jobs = [];
  Object.keys(collectionToCheck).forEach((collectionName) => {
    jobs.push((cb) => {
      // display log
      app.logger.debug(`Retrieving records from '${collectionName}'`);

      // update
      app.dataSources.mongoDb.connector
        .collection(collectionName)
        .find({
          $or: [
            {
              deleted: false
            },
            {
              deleted: {
                $eq: null
              }
            }
          ]
        })
        .toArray()
        .then(function (records) {
          // display log
          app.logger.debug(`Records retrieved for '${collectionName}'`);

          // check records
          (records || []).forEach((record) => {
            checkObjectForTokens(record);
          });

          // finished
          cb();
        })
        .catch(cb);
    });
  });

  // connect to database
  collectionToCheck[Object.keys(collectionToCheck)[0]].dataSource.connect((err) => {
    // error
    if (err) {
      return callback(err);
    }

    // wait for all operations to be done
    async.parallelLimit(jobs, 10, function (error) {
      // error
      if (error) {
        return callback(error);
      }

      // display log
      app.logger.debug(`Found ${Object.keys(usedTokens).length} tokens that we need to keep`);

      // retrieve language tokens that we need to remove
      // we could remove them by this condition, but we want to log exactly what records are removed
      app.logger.debug('Retrieve unused tokens');
      app.dataSources.mongoDb.connector
        .collection(languageTokensCollectiion)
        .find({
          $or: [
            {
              deleted: false
            },
            {
              deleted: {
                $eq: null
              }
            }
          ],
          token: {
            $nin: Object.keys(usedTokens)
          }
        }, {
          projection: {
            _id: 1,
            token: 1,
            languageId: 1
          }
        })
        .toArray()
        .then(function (records) {
          // display log
          app.logger.debug('Unused tokens retrieved');

          // determine token ids since the same token is duplicated for each language, we will have multiple
          const idsToRemove = [];
          (records || []).forEach((record) => {
            if (module.confirmRemoval) {
              idsToRemove.push(record._id);
              app.logger.debug(`Preparing to remove token '${record.token}' from language '${record.languageId}'`);
            } else {
              app.logger.debug(`Should remove token '${record.token}' from language '${record.languageId}'`);
            }
          });

          // do we need to remove tokens ?
          if (module.confirmRemoval) {
            // log
            app.logger.debug(`Removing ${idsToRemove.length} tokens`);

            // bulk soft delete tokens
            const deletionDate = new Date();
            app.dataSources.mongoDb.connector
              .collection(languageTokensCollectiion)
              .updateMany({
                _id: {
                  $in: idsToRemove
                }
              }, {
                $set: {
                  deleted: true,
                  deletedAt: deletionDate
                }
              })
              .then(() => {
                // log
                app.logger.debug(`Removed ${idsToRemove.length} tokens`);

                // finished
                callback();
              })
              .catch(callback);
          } else {
            // log
            app.logger.debug(`Should remove ${idsToRemove.length} tokens`);

            // finished
            callback();
          }
        })
        .catch(callback);
    });
  });

  // module.confirmRemoval
}

module.exports = (confirmRemoval) => {
  // keep path
  module.confirmRemoval = confirmRemoval;

  // finished
  return run;
};
