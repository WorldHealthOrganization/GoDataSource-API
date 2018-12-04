'use strict';

const _ = require('lodash');
const app = require('../server');
const Timer = require('../../components/Timer');
const uuid = require('uuid');

/**
 * Raw Find (avoid loopback ODM)
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
   * @return {Promise<any>}
   */
  Model.rawFind = function () {
    const queryId = uuid.v4();
    const timer = new Timer();
    timer.start();
    // get function arguments
    const args = Array.prototype.slice.call(arguments);
    // if there is a default scope query
    if (defaultScopeQuery) {
      // merge it in the sent query
      args[0] = app.utils.remote
        .convertLoopbackFilterToMongo(
          app.utils.remote.mergeFilters({where: defaultScopeQuery}, {where: args[0]})
        ).where;
    }
    app.logger.debug(`[QueryId: ${queryId}] Performing MongoDB request on collection '${collectionName}': find ${JSON.stringify(args)}`);
    // promisify the action
    return new Promise(function (resolve, reject) {
      // perform find using mongo connector
      app.dataSources.mongoDb.connector.collection(collectionName)
        .find(...args)
        // convert result to array
        .toArray(function (error, records) {
          app.logger.debug(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);
          // handle errors
          if (error) {
            return reject(error);
          }
          // add id property (not the native _id property)
          records.forEach(function (record) {
            record.id = record._id;
            delete record._id;
          });
          resolve(records);
        });
    });
  };
};
