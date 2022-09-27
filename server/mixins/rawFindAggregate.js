'use strict';

const _ = require('lodash');
const app = require('../server');
const Timer = require('../../components/Timer');
const uuid = require('uuid');
const config = require('../config');

/**
 * Raw Find Aggregate (avoid loopback ODM)
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
   * @param {object} [filter]
   * @param {object} [filter.where]
   * @param {number} [filter.skip]
   * @param {number} [filter.limit]
   * @param {array} [filter.order]
   * @param {array} [filter.fields]
   * @param {boolean} [filter.deleted]
   * @param {object} [options]
   * @param {boolean} [options.ignoreDefaultScope]
   * @param {boolean} [options.countOnly]
   * @param {array} [options.relations]
   * @param {boolean} [options.matchAfterLookup]
   * @return {Promise<any>}
   */
  Model.rawFindAggregate = function (filter = {}, options = {}) {
    // set query id and start timer (for logging purposes)
    const queryId = uuid.v4();
    const timer = new Timer();
    timer.start();

    // make sure we have data
    options = options || {};
    filter = filter || {};

    // extract applyHasMoreLimit
    let applyHasMoreLimit = false;
    if (
      filter.flags &&
      filter.flags.applyHasMoreLimit
    ) {
      applyHasMoreLimit = true;
    }

    // include not supported
    if (filter.include) {
      delete filter.include;
    }

    // convert filter to mongodb filter structure
    let whereFilter = filter.where ? app.utils.remote.convertLoopbackFilterToMongo(filter.where) : {};

    // if there is a default scope query
    if (
      defaultScopeQuery &&
      !options.ignoreDefaultScope
    ) {
      // merge it in the sent query
      whereFilter = _.isEmpty(whereFilter) ?
        defaultScopeQuery : {
          $and: [
            defaultScopeQuery,
            whereFilter
          ]
        };
    }

    // add soft deleted condition if not specified otherwise
    if (!filter.deleted) {
      // deleted condition
      const whereAdditionalConditions = {
        deleted: false
      };

      // construct the final query filter
      whereFilter = _.isEmpty(whereFilter) ?
        whereAdditionalConditions : {
          $and: [
            whereFilter,
            whereAdditionalConditions
          ]
        };
    }

    // pipeline
    const aggregatePipeline = [];

    // geoLocation distance filters need to be run before lookup ( they don't work otherwise - MongoDB )
    // - this means that we won't be able to filter by related model geolocation distance ( duh...we don't have related data since it is added later )
    // - also, this will work only for AND conditions, it won't work for OR conditions
    // construct list of possible geo points filter properties for our model
    const geoNear = [];
    if (Model.nestedGeoPoints) {
      const listOfGeoPoints = [];
      Model.nestedGeoPoints.forEach((property) => {
        listOfGeoPoints.push(property);
        if (property.indexOf('[]') > -1) {
          listOfGeoPoints.push(property.replace(/\[]/g, ''));
        }
      });
      const checkPropertiesForGeoLocationCondition = (filterData) => {
        _.each(filterData, (value, property) => {
          if (
            typeof property === 'string' &&
            listOfGeoPoints.includes(property) &&
            value.$geoNear
          ) {
            // create geo near condition
            const geoNearCondition = {
              near: value.$geoNear.$geometry,
              spherical: true,
              key: property,
              distanceField: `${_.camelCase(property)}_distance`
            };

            // add max distance
            if (value.$geoNear.$maxDistance) {
              geoNearCondition.maxDistance = value.$geoNear.$maxDistance;
            }

            // add min distance
            if (value.$geoNear.$minDistance) {
              geoNearCondition.minDistance = value.$geoNear.$minDistance;
            }

            // add condition to list
            geoNear.push(geoNearCondition);

            // remove search criteria since will be handled separately
            delete value.$geoNear;

            // remove the entire filter ?
            if (_.isEmpty(filterData[property])) {
              delete filterData[property];
            }
          } else if (
            _.isArray(value) ||
            _.isObject(value)
          ) {
            // check depper
            checkPropertiesForGeoLocationCondition(value);
          }
        });
      };
      checkPropertiesForGeoLocationCondition(whereFilter);
    }

    // apply filter before doing anything else
    if (geoNear.length > 0) {
      geoNear.forEach((geoNearConf) => {
        aggregatePipeline.push({
          $geoNear: geoNearConf
        });
      });
    }

    if (!options.matchAfterLookup) {
      // construct aggregate filters
      aggregatePipeline.push({
        $match: whereFilter
      });
    }

    // include relations
    if (options.relations) {
      _.each(options.relations, (relation) => {
        // lookup
        if (relation.lookup) {
          aggregatePipeline.push({
            $lookup: relation.lookup
          });
        }

        // unwind
        if (relation.unwind) {
          aggregatePipeline.push({
            $unwind: {
              path: `$${relation.lookup.as}`,
              preserveNullAndEmptyArrays: true
            }
          });
        }
      });
    }

    if (options.matchAfterLookup) {
      // construct aggregate filters
      aggregatePipeline.push({
        $match: whereFilter
      });
    }

    // determine if we need to apply count limit
    const countLimit = filter.limit === false ?
      undefined : (
        filter.limit > 0 ?
          filter.limit : (
            applyHasMoreLimit && config.count && config.count.limit > 0 ?
              config.count.limit :
              undefined
          )
      );

    // no need to retrieve data, sort & skip records if we just need to count
    if (options.countOnly) {
      // limit count
      if (countLimit > 0) {
        aggregatePipeline.push({
          $limit: countLimit
        });
      }

      // count
      aggregatePipeline.push({
        $group: {
          _id: null,
          count: {
            $sum: 1
          }
        }
      });
    } else {
      // parse order props
      const knownOrderTypes = {
        ASC: 1,
        DESC: -1
      };
      const orderProps = {};
      if (Array.isArray(filter.order)) {
        filter.order.forEach((pair) => {
          // split prop and order type
          const split = pair.split(' ');
          // ignore if we don't receive a pair
          if (split.length !== 2) {
            return;
          }
          split[1] = split[1].toUpperCase();
          // make sure the order type is known
          if (!knownOrderTypes.hasOwnProperty(split[1])) {
            return;
          }
          orderProps[split[0]] = knownOrderTypes[split[1]];
        });
      }

      // do not add sort with 0 items, it will throw error
      if (Object.keys(orderProps).length) {
        aggregatePipeline.push({
          $sort: orderProps
        });
      }

      // we only add pagination fields if they are numbers
      // otherwise aggregation will fail
      if (!isNaN(filter.skip)) {
        aggregatePipeline.push({
          $skip: filter.skip
        });
      }
      if (!isNaN(filter.limit)) {
        aggregatePipeline.push({
          $limit: filter.limit
        });
      }

      // retrieve only specific fields
      if (filter.fields) {
        // construct projection array
        const projection = {};
        (filter.fields || []).forEach((field) => {
          if (!_.isEmpty(field)) {
            projection[field] = true;
          }
        });

        // retrieve only specific fields
        if (!_.isEmpty(projection)) {
          aggregatePipeline.push({
            $project: projection
          });
        }
      }
    }

    // log usage
    app.logger.debug(`[QueryId: ${queryId}] Performing MongoDB aggregate request on collection '${collectionName}': aggregate ${JSON.stringify(aggregatePipeline)}`);

    // retrieve data
    return app.dataSources.mongoDb.connector
      .collection(collectionName)
      .aggregate(
        aggregatePipeline, {
          allowDiskUse: true
        }
      )
      .toArray()
      .then((records) => {
        // log time need to execute query
        app.logger.debug(`[QueryId: ${queryId}] MongoDB request completed after ${timer.getElapsedMilliseconds()} msec`);

        // make sure we have an array
        records = records || [];

        // count records ?
        if (options.countOnly) {
          const counted = records && records.length > 0 ?
            records[0].count :
            0;
          return {
            count: counted,
            hasMore: countLimit && countLimit > 0 && counted >= countLimit
          };
        }

        // format records
        records.forEach((record) => {
          // replace id
          record.id = record._id;
          delete record._id;

          // tap relationships
          if (options.relations) {
            _.each(options.relations, (relation) => {
              if (
                relation.map &&
                relation.lookup &&
                relation.lookup.as &&
                record[relation.lookup.as]
              ) {
                record[relation.lookup.as] = relation.map(record[relation.lookup.as]);
              }
            });
          }
        });

        // pass records further
        return records;
      });
  };
};
