'use strict';

const MongoDBHelper = require('../../../../../components/mongoDBHelper');
const Helpers = require('../../../../../components/helpers');
const _ = require('lodash');
const Config = require('../../../../config.json');

// get the default outbreak maps servers from configuration file
// used in updateMapServers function
const defaultArcGisServers = _.get(Config, 'defaultArcGisServers', []);

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 1000;

// set how many item update actions to run in parallel
const updateBatchSize = 10;

/**
 * Add missing sort keys to language tokens
 * @param callback
 */
const updateMapServers = (callback) => {
  // return if no default map is configured
  if (defaultArcGisServers.length === 0) {
    return;
  }
  // create Mongo DB connection
  let outbreakCollection;
  return MongoDBHelper
    .getMongoDBConnection()
    .then(dbConn => {
      outbreakCollection = dbConn.collection('outbreak');

      // create filter
      // - update deleted items too
      // - update only items that have old default maps
      let outbreakFilter = {
        $and: [
          {
            arcGisServers: {
              $size: 2
            }
          },
          {
            'arcGisServers.url': 'http://maps.who.int/arcgis/rest/services/Basemap/WHO_West_Africa_background_7/MapServer'
          },
          {
            'arcGisServers.url': 'http://maps.who.int/arcgis/rest/services/Basemap/WHO_Reference_layer/MapServer'
          }]
      };

      // initialize parameters for handleActionsInBatches call
      const getActionsCount = () => {
        // count records that we need to update
        return outbreakCollection
          .countDocuments(outbreakFilter);
      };

      // get records in batches
      const getBatchData = (batchNo, batchSize) => {
        return outbreakCollection
          .find(outbreakFilter, {
            // always getting the first items as the already modified ones are filtered out
            skip: 0,
            limit: batchSize,
            projection: {
              _id: 1
            }
          })
          .toArray();
      };

      // update records
      const itemAction = (data) => {
        // determine what we need to update
        const setData = {};

        // set the default maps
        setData.arcGisServers = [];
        defaultArcGisServers.forEach((map) => {
          setData.arcGisServers.push(
            {
              name: map.name,
              url: map.url,
              type: map.type,
              styleUrl: map.styleUrl,
              styleUrlSource: map.styleUrlSource
            }
          );
        });

        // update
        return outbreakCollection
          .updateOne({
            _id: data._id
          }, {
            '$set': setData
          });
      };

      // execute jobs in batches
      return Helpers.handleActionsInBatches(
        getActionsCount,
        getBatchData,
        null,
        itemAction,
        findBatchSize,
        updateBatchSize,
        console
      );
    })
    .then(() => {
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  updateMapServers
};
