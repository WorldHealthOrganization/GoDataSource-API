'use strict';

/**
 * Helper for MongoDB actions
 * Behaves as a singleton using a single connection for the entire process
 */

const MongoClient = require('mongodb').MongoClient;
const dbConfig = require('./../server/datasources').mongoDb;
const convertLoopbackQueryToMongo = require('./convertLoopbackFilterToMongo');
const Timer = require('./Timer');
const uuid = require('uuid');

// initialize DB connection cache
let mongoDBConnection;

/**
 * Get MongoDB client
 * @param {Object} mongoOptions - MongoDB connection options
 * @returns {Promise<MongoClient>}
 */
function getMongoDBClient(mongoOptions = {}) {
  // make sure it doesn't timeout
  mongoOptions = Object.assign({}, mongoOptions, {
    keepAlive: true,
    connectTimeoutMS: 1800000, // 30 minutes
    socketTimeoutMS: 1800000 // 30 minutes
  });

  // attach auth credentials
  if (dbConfig.password) {
    mongoOptions = Object.assign(mongoOptions, {
      auth: {
        username: dbConfig.user,
        password: dbConfig.password
      },
      authSource: dbConfig.authSource
    });
  }

  // retrieve mongodb connection
  return MongoClient
    .connect(`mongodb://${dbConfig.host}:${dbConfig.port}`, mongoOptions);
}

/**
 * Create MongoDB connection and return it
 * @param {Object} mongoOptions - MongoDB connection options
 * @returns {Promise<Db | never>}
 */
function getMongoDBConnection(mongoOptions = {}) {
  // use existing connection if one was already initialized
  // this is in order to prevent creating new connections for different actions
  if (mongoDBConnection) {
    return Promise.resolve(mongoDBConnection);
  }

  return getMongoDBClient(mongoOptions)
    .then(function (client) {
      // cache connection
      mongoDBConnection = client
        .db(dbConfig.database);

      return Promise.resolve(mongoDBConnection);
    });
}

/**
 * Parse Loopback fields property to MongoDB projection
 * @param fields
 * @returns {{}}
 */
function getMongoDBProjectionFromLoopbackFields(fields = []) {
  let projection = {};
  fields.forEach(field => projection[field] = 1);

  return projection;
}

/**
 * Parses a Loopback complete filter to mongoDB filter options
 * @param filter Loopback filter
 * @returns {{limit: number, where: {}, skip: number, sort: {}, projection: {}}}
 */
function getMongoDBOptionsFromLoopbackFilter(filter = {}) {
  let parsedFilter = {
    where: filter.where ? convertLoopbackQueryToMongo(filter.where) : {}
  };

  // skip
  filter.skip && (parsedFilter.skip = filter.skip);

  // limit
  if ('limit' in filter) {
    const limit = parseInt(filter.limit, 10);
    parsedFilter.limit = isNaN(limit) ? 0 : Math.max(0, limit);
  }
  // projection
  if (filter.fields) {
    parsedFilter.projection = getMongoDBProjectionFromLoopbackFields(filter.fields);
  }

  // sort
  if (filter.order) {
    parsedFilter.sort = {};
    filter.order.forEach(entry => {
      let entryParts = entry.split(' ');
      let field = entryParts[0];
      // if field order was sent as DESC we will sort DESC else we will sort ASC
      parsedFilter.sort[field] = entryParts[1] && ['desc', 'DESC'].indexOf(entryParts[1]) !== -1 ? -1 : 1;
    });
  }

  return parsedFilter;
}

/**
 * Wrapper for MongoDB action
 * Adds identifiers and logs and mimics raw responses from Loopback (eg: replaces _id with id)
 * @param collectionName Collection name on which the action should be executed
 * @param actionName Action name to be executed on MongoDB collection
 * @param params Array of parameters to be sent to the action
 * @param logger
 * @returns {*}
 */
function executeAction(collectionName, actionName, params, logger = console) {
  // set queryId and start timer (for logging purposes)
  const queryId = uuid.v4();
  const timer = new Timer();
  timer.start();

  logger.debug(`[QueryId: ${queryId}] Performing MongoDB request on collection '${collectionName}': ${actionName} ${JSON.stringify(params)}`);

  return getMongoDBConnection()
    .then(dbConn => {
      const collection = dbConn.collection(collectionName);
      return actionName === 'find' ?
        collection[actionName](...params).toArray() :
        collection[actionName](...params);
    })
    .then(result => {
      logger.debug(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);

      if (actionName === 'find') {
        result.forEach(function (record) {
          record.id = record._id;
          delete record._id;
        });
      } else if (actionName === 'findOne') {
        result.id = result._id;
        delete result._id;
      } else {
        // no response parsing for other actions
      }

      return Promise.resolve(result);
    })
    .catch(err => {
      logger.debug(`[QueryId: ${queryId}] MongoDB request completed with error after ${timer.getElapsedMilliseconds()} msec`);
      return Promise.reject(err);
    });
}

module.exports = {
  getMongoDBClient,
  getMongoDBConnection,
  getMongoDBOptionsFromLoopbackFilter,
  executeAction
};
