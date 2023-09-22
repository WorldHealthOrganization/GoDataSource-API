'use strict';

const _ = require('lodash');
const App = require('../server');
const Timer = require('../../components/Timer');
const Uuid = require('uuid');
const localizationHelper = require('../../components/localizationHelper');

/**
 * Raw Bulk Remove (avoid loopback ODM)
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
   * Find using connector
   * @param query
   * @return {Promise<any>}
   */
  Model.rawBulkDelete = function (query) {
    // create a soft delete operation object
    const op = {
      $set: {
        deleted: true,
        deletedAt: localizationHelper.now().toDate(),
        dbUpdatedAt: localizationHelper.now().toDate()
      }
    };

    // query id and timer (for logging purposes)
    const queryId = Uuid.v4();
    const timer = new Timer();
    timer.start();

    // if there is a default scope query
    if (defaultScopeQuery) {
      // merge it in the sent query
      query = {
        $and: [
          defaultScopeQuery,
          query
        ]
      };
    }

    // query only non deleted data
    query = App.utils.remote.convertLoopbackFilterToMongo(
      {
        $and: [
          {
            deleted: false
          },
          query
        ]
      });

    // log usage
    App.logger.debug(`[QueryId: ${queryId}] Performing MongoDB operation on collection '${collectionName}': soft delete ${JSON.stringify(query)}`);

    // perform a bulk update on the mongodb native driver
    // with 'deleted: true' operation (soft delete)
    return App.dataSources.mongoDb.connector.collection(collectionName)
      .updateMany(query, op)
      .then((result) => {
        App.logger.debug(`[QueryId: ${queryId}] MongoDB bulk delete completed after ${timer.getElapsedMilliseconds()} msec`);
        return result;
      });
  };

  Model.rawBulkHardDelete = function (query) {
    // query id and timer (for logging purposes)
    const queryId = Uuid.v4();
    const timer = new Timer();
    timer.start();


    // if there is a default scope query
    if (defaultScopeQuery) {
      // merge it in the sent query
      query = {
        $and: [
          defaultScopeQuery,
          query
        ]
      };
    }

    query = App.utils.remote.convertLoopbackFilterToMongo(query);

    // log usage
    App.logger.debug(`[QueryId: ${queryId}] Performing MongoDB operation on collection '${collectionName}': hard delete ${JSON.stringify(query)}`);

    // perform a bulk update on the mongodb native driver
    // with 'deleted: true' operation (soft delete)
    return App.dataSources.mongoDb.connector.collection(collectionName)
      .deleteMany(query)
      .then((result) => {
        App.logger.debug(`[QueryId: ${queryId}] MongoDB bulk delete completed after ${timer.getElapsedMilliseconds()} msec`);
        return result;
      });
  };
};
