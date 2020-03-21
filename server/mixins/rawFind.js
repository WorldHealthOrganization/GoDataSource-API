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
   * @param query
   * @param {object} [options]
   * @param {number} [options.skip]
   * @param {number} [options.limit]
   * @param {object} [options.order]
   * @param {object} [options.projection]
   * @param {object} [options.includeDeletedRecords]
   * @return {Promise<any>}
   */
  Model.rawFind = function (query, options = {}) {
    options = options || {};
    query = query || {};

    // set query id and start timer (for logging purposes)
    const queryId = uuid.v4();
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

    // make sure filter is valid for mongodb
    query = app.utils.remote.convertLoopbackFilterToMongo(query);

    // query only non deleted data
    if (!options.includeDeletedRecords) {
      query = {
        $and: [
          query,
          {
            deleted: {
              $ne: true
            }
          }
        ]
      };
    }

    // log usage
    app.logger.debug(`[QueryId: ${queryId}] Performing MongoDB request on collection '${collectionName}': find ${JSON.stringify(query)}`);

    // perform find using mongo connector
    let queryDb = app.dataSources.mongoDb.connector.collection(collectionName)
      .find(query, {projection: options.projection});

    // sort, if needed
    if (options.order) {
      queryDb = queryDb.sort(options.order);
    }

    // apply skip
    if (options.skip) {
      queryDb = queryDb.skip(options.skip);
    }

    // apply limit
    if (options.limit) {
      queryDb = queryDb.limit(options.limit);
    }

    // convert result to array
    return queryDb
      .toArray()
      .then(function (records) {
        app.logger.debug(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);
        // add id property (not the native _id property)
        records.forEach(function (record) {
          record.id = record._id;
          delete record._id;
        });
        return records;
      });
  };
};
