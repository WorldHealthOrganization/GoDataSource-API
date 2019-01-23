'use strict';

const _ = require('lodash');
const app = require('../server');
const Timer = require('../../components/Timer');
const uuid = require('uuid');

/**
 * Raw Update One (avoid loopback ODM)
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
   * Update using connector
   * @param filter
   * @param update
   * @param reqOpts
   * @param options
   * @return {Promise<any>}
   */
  Model.rawUpdateOne = function (filter, update, reqOpts = {}, options = {}) {
    filter = filter || {};
    // set query id and start timer (for logging purposes)
    const queryId = uuid.v4();
    const timer = new Timer();
    timer.start();
    // update stamps
    update.updatedAt = new Date();
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
    filter = app.utils.remote.convertLoopbackFilterToMongo(
      {
        $and: [
          {
            $or: [
              {deleted: false},
              {deleted: {$eq: null}}
            ]
          },
          filter
        ]
      });

    // log usage
    app.logger.debug(`[QueryId: ${queryId}] Performing MongoDB request on collection '${collectionName}': updateOne query: ${JSON.stringify(filter)} update: ${JSON.stringify(update)}`);

    // perform update using mongo connector
    let updateDb = app.dataSources.mongoDb.connector.collection(collectionName)
      .findOneAndUpdate(filter, {$set: update}, options);


    // handle result
    return updateDb
      .then(function (result) {
        app.logger.debug(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);
        const record = result.value;
        // add id property (not the native _id property)
        record.id = record._id;
        delete record._id;
        return record;
      });
  };
};
