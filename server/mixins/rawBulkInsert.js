'use strict';

const _ = require('lodash');
const App = require('../server');
const Timer = require('../../components/Timer');
const localizationHelper = require('../../components/localizationHelper');
const Uuid = require('uuid').v4;

/**
 * Raw Insert (avoid loopback ODM)
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

  /**
   * Insert using MongoDb native nodejs driver
   * Opts reference: https://mongodb.github.io/node-mongodb-native/3.1/api/Collection.html#insertMany
   * @param data List of records to insert
   * @param opts Supported options mapped from driver itself
   * @param reqOpts Request options, used to find the logged in user
   * @return {Promise<any>}
   */
  Model.rawBulkInsert = function (data = [], opts = {}, reqOpts = {}) {
    if (!data.length) {
      return null;
    }

    // get logged in user from request options in order to create author fields
    // for sync, logged user model is added in a custom property
    const userModelInstanceId = _.get(reqOpts, 'remotingContext.req.authData.userModelInstance.id');
    let userId = userModelInstanceId ?
      userModelInstanceId :
      _.get(reqOpts, 'accessToken.userId', 'unavailable');

    // get platform from request options in order to set the "created on" field
    const platform = _.get(reqOpts, 'platform');

    // used for author timestamps
    let now = localizationHelper.now().toDate();

    // get through each record and attach author fields (timestamps and 'by' fields)
    data = data.map((record) => {
      // create unique id
      record._id = record.id || Uuid();

      // enable soft delete feature
      record.deleted = false;

      // enable author fields
      record.createdAt = now;
      record.updatedAt = now;
      record.dbUpdatedAt = now;
      record.createdBy = userId;
      record.updatedBy = userId;

      // platform
      record.createdOn = platform;

      return record;
    });

    // set query id and start timer (for logging purposes)
    const queryId = Uuid();
    const timer = new Timer();
    timer.start();

    // log usage
    App.logger.debug(`[QueryId: ${queryId}] Performing MongoDB insert on collection '${collectionName}'}`);

    // perform insert using mongodb native driver
    return App.dataSources.mongoDb.connector.collection(collectionName)
      .insertMany(data, opts)
      .then((result) => {
        App.logger.debug(`[QueryId: ${queryId}] MongoDB bulk insert completed after ${timer.getElapsedMilliseconds()} msec`);
        return result;
      });
  };
};
