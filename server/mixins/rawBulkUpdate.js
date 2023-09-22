'use strict';

const _ = require('lodash');
const App = require('../server');
const Timer = require('../../components/Timer');
const Uuid = require('uuid');
const localizationHelper = require('../../components/localizationHelper');

/**
 * Raw Bulk Update (avoid loopback ODM)
 * @param Model
 */
module.exports = function (Model) {
  // get collection name from settings (if defined)
  let collectionName = _.get(Model, 'definition.settings.mongodb.collection');
  // if collection name was not defined in settings
  if (!collectionName) {
    // get it from model name
    collectionName = Model.modelName;
  }
  // get default scope query, if any
  const defaultScopeQuery = _.get(Model, 'definition.settings.scope.where');

  /**
   * Update using connector; On partial success returns the IDs of the failed resources
   * @param filter
   * @param update
   * @param reqOpts
   * @param options
   * @return {Promise<any>}
   */
  Model.rawBulkUpdate = function (filter, update, reqOpts = {}, options = {}) {
    filter = filter || {};
    // set query id and start timer (for logging purposes)
    const queryId = Uuid.v4();
    const timer = new Timer();
    timer.start();
    // update stamps
    update.updatedAt = localizationHelper.now().toDate();
    update.updatedBy = _.get(reqOpts, 'accessToken.userId', 'unavailable');

    // if there is a default scope query
    if (defaultScopeQuery) {
      // merge it in the sent query
      filter = {
        $and: [
          defaultScopeQuery,
          filter
        ]
      };
    }

    // query only non deleted data
    filter = App.utils.remote.convertLoopbackFilterToMongo(
      {
        $and: [
          {
            deleted: false
          },
          filter
        ]
      });

    // log usage
    App.logger.debug(`[QueryId: ${queryId}] Performing MongoDB request on collection '${collectionName}': updateMany query: ${JSON.stringify(filter)} update: ${JSON.stringify(update)}`);

    // get collection
    const collection = App.dataSources.mongoDb.connector.collection(collectionName);

    // intialize result
    let actionResult;

    // perform update using mongo connector
    return collection
      .updateMany(filter, {$set: update}, options)
      .then(function (result) {
        App.logger.debug(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);

        // get result properties
        actionResult = {
          matched: result.matchedCount,
          modified: result.modifiedCount
        };

        // check if all the matched resources were updated
        if (result.matchedCount !== result.modifiedCount) {
          // get the resources that weren't updated; the resources that match the filter but have an older updatedAt
          // update filter
          filter['$and'].push({
            updatedAt: {
              '$lte': update.updatedAt
            }
          });

          return collection
            .find(filter, {
              projection: {
                _id: 1
              }
            })
            .toArray()
            .catch(function (err) {
              App.logger.debug(`[QueryId: ${queryId}] Failed retrieving resources that were not modified for collection '${collectionName}'. Error: ${err.message}`);
            });
        }

        // all matched resources were modified
        return Promise.resolve();
      })
      .then(function (resourcesNotUpdated) {
        // resourcesNotUpdated are returned only if there were errors on the updateMany action
        if (resourcesNotUpdated && resourcesNotUpdated.length) {
          let resourcesNotUpdatedIDs = resourcesNotUpdated.map(resource => resource._id);
          App.logger.debug(`[QueryId: ${queryId}] MongoDB request completed with failures for the following '${collectionName}' collection resources: ${resourcesNotUpdatedIDs.join(', ')}`);
          // update result
          actionResult.notModified = resourcesNotUpdatedIDs.length;
          actionResult.notModifiedIDs = resourcesNotUpdatedIDs;
        }

        return actionResult;
      });
  };
};
