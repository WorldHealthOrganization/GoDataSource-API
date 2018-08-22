'use strict';

const app = require('../server');
const _ = require('lodash');

/**
 * Workaround for a loopbpack/mongo issue:
 * Loopback sends all model properties (at least those that have sub-definitions) without values to Mongo, as undefined. Mongo converts undefined in null
 * There's a property (ignoreUndefined) for MongoDB driver, that will solve the issue, however the property is send
 * in 'findAndModify' function. Saving indexed Geolocations in MongoDB with null values results in 'Can't extract geoKeys' error
 * To work around this issue, we defined an invalid location (in the middle of pacific ocean) that will be saved for undefined
 * GeoLocations. This special value is handled by the API and it will be removed from GET responses
 * @type {number}
 */
const INVALID_LATITUDE = 0.0000000001;
const INVALID_LONGITUDE = 179.0000000001;

/**
 * Extract data source and target from context
 * @param context
 */
function getSourceAndTargetFromContext(context) {
  const result = {};
  // data source & target can be on context instance
  if (context.instance) {
    // if this is an model instance
    if (context.instance.toJSON === 'function') {
      // get data
      result.source = context.instance.toJSON();
    } else {
      result.source = context.instance;
    }
    result.target = context.instance;
  } else {
    // data source & target are on context data
    result.source = context.data;
    result.target = context.data;
  }
  return result;
}

/**
 * Convert nested GeoPoints to valid MongoDB GeoPoint
 * Loopback does not automatically convert GeoPoints nested in other objects
 * @param Model
 */
module.exports = function (Model) {

  /**
   * Convert MongoDB format to Loopback format
   * @param context
   */
  function prepareDataForRead(context) {
    // get data source and target from context
    const data = getSourceAndTargetFromContext(context);

    // convert each (declared) nested GeoPoint
    Model.nestedGeoPoints.forEach(function (property) {
      // get current value and path
      let nestedGeoPoint = app.utils.helpers.getReferencedValue(data.source, property);

      // always works with same data type (simplify logic)
      if (!Array.isArray(nestedGeoPoint)) {
        nestedGeoPoint = [nestedGeoPoint];
      }
      // go through each nested GeoPoint
      nestedGeoPoint.forEach(function (nestedPoint) {
        // data available in DB format
        if (
          nestedPoint.value &&
          nestedPoint.value.coordinates &&
          nestedPoint.value.coordinates[0] != null &&
          nestedPoint.value.coordinates[1] != null
        ) {
          let latitude = nestedPoint.value.coordinates[1];
          let longitude = nestedPoint.value.coordinates[0];

          // remove invalid values GeoLocations
          if (latitude === INVALID_LATITUDE && longitude === INVALID_LONGITUDE) {
            // no data available, unset the property
            _.set(data.target, nestedPoint.exactPath, undefined);
          } else {
            // convert it
            _.set(data.target, nestedPoint.exactPath, {
              lat: latitude,
              lng: longitude
            });
          }
        } else if (
          nestedPoint.value &&
          nestedPoint.value.lat != null &&
          nestedPoint.value.lng != null
        ) {
          // data available in read format
          // make sure only lat and lng properties are used
          _.set(data.target, nestedPoint.exactPath, {
            lat: nestedPoint.value.lat,
            lng: nestedPoint.value.lng
          });
        } else {
          // no data available, unset the property
          _.set(data.target, nestedPoint.exactPath, undefined);
        }
      });
    });
  }

  /**
   * Convert Loopback format to MongoDB format
   * @param context
   */
  function prepareDataForDB(context) {
    // get data source and target from context
    const data = getSourceAndTargetFromContext(context);

    // convert each (declared) nested GeoPoint
    Model.nestedGeoPoints.forEach(function (property) {
      // get current value and path
      let nestedGeoPoint = app.utils.helpers.getReferencedValue(data.source, property);

      // always works with same data type (simplify logic)
      if (!Array.isArray(nestedGeoPoint)) {
        nestedGeoPoint = [nestedGeoPoint];
      }
      // go through each nested GeoPoint
      nestedGeoPoint.forEach(function (nestedPoint) {
        // data available in read format
        if (
          nestedPoint.value &&
          nestedPoint.value.lng != null &&
          nestedPoint.value.lat != null
        ) {
          // convert it
          _.set(data.target, nestedPoint.exactPath, {
            coordinates: [nestedPoint.value.lng, nestedPoint.value.lat],
            type: 'Point'
          });
        } else if (
          nestedPoint.value &&
          nestedPoint.value.coordinates &&
          nestedPoint.value.coordinates[0] != null &&
          nestedPoint.value.coordinates[1] != null
        ) {
          // data available in DB format
          // make sure only coordinates and type properties are used
          _.set(data.target, nestedPoint.exactPath, {
            coordinates: nestedPoint.value.coordinates,
            type: 'Point'
          });
        } else {
          _.set(data.target, nestedPoint.exactPath, {
            coordinates: [INVALID_LONGITUDE, INVALID_LATITUDE],
            type: 'Point'
          });
        }
      });
    });
  }

  // if model definition contains nested GeoPoints
  if (Model.nestedGeoPoints && Model.nestedGeoPoints.length) {

    Model.observe('before save', function convertToMongoDB(context, next) {
      prepareDataForDB(context);
      next();
    });

    Model.observe('after save', function convertToLoopback(context, next) {
      prepareDataForRead(context);
      next();
    });

    Model.observe('loaded', function convertToLoopback(context, next) {
      prepareDataForRead(context);
      next();
    });
  }
};
