'use strict';

const _ = require('lodash');
const app = require('../server');
const Timer = require('../../components/Timer');
const uuid = require('uuid');
const config = require('../config');

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
   * @param filter
   * @param {object} [options]
   * @param {number} [options.skip]
   * @param {number} [options.limit]
   * @param {object} [options.includeDeletedRecords]
   * @param {object} [options.applyHasMoreLimit]
   * @param {object} [options.hint]
   * @return {Promise<number>}
   */
  Model.rawCountDocuments = function (filter, options = {}) {
    options = options || {};
    filter = filter || {};
    let query = filter.where || {};

    // extract applyHasMoreLimit
    let applyHasMoreLimit = false;
    if (
      filter.flags &&
      filter.flags.applyHasMoreLimit
    ) {
      applyHasMoreLimit = true;
    }

    // filter limit
    if (
      !options.limit &&
      filter.limit
    ) {
      options.limit = filter.limit;
    }

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

    // where include ?
    if (
      query.includeDeletedRecords ||
      filter.deleted
    ) {
      delete query.includeDeletedRecords;
      options.includeDeletedRecords = true;
    }

    // query only non deleted data
    if (!options.includeDeletedRecords) {
      query = {
        $and: [
          query,
          {
            deleted: false
          }
        ]
      };
    }

    // log usage
    app.logger.debug(`[QueryId: ${queryId}] Performing MongoDB request on collection '${collectionName}': count documents ${JSON.stringify(query)}`);

    // determine if we need to apply count limit
    const countLimit = options.limit === false ?
      undefined : (
        options.limit > 0 ?
          options.limit : (
            applyHasMoreLimit && config.count && config.count.limit > 0 ?
              config.count.limit :
              undefined
          )
      );

    // perform find using mongo connector
    return app.dataSources.mongoDb.connector.collection(collectionName)
      .count(
        query, {
          limit: countLimit,
          skip: options.skip,
          hint: options.hint
        }
      )
      .then((counted) => {
        app.logger.debug(`[QueryId: ${queryId}] MongoDB request completed with error after ${timer.getElapsedMilliseconds()} msec`);

        // finished
        return {
          count: counted,
          hasMore: countLimit && countLimit > 0 && counted >= countLimit
        };
      });
  };
};
