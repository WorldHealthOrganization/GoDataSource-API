'use strict';

const app = require('../server');
const _ = require('lodash');

/**
 * Extract data source and target from context
 * @param context
 */
function getSourceAndTargetFromContext(context) {
  const result = {};
  // data source & target can be on context instance
  if (context.instance) {
    // if this is an model instance
    if (typeof context.instance.toJSON === 'function') {
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
   * Unset a loopback model property
   * @param target
   * @param path
   */
  function unsetProperty(
    target,
    path
  ) {
    // check if we can use unsetAttribute to properly remove a loopback model property
    // determine parent name
    const parentIndex = path.lastIndexOf('.');
    if (parentIndex > -1) {
      const childTarget = _.get(target, path.substring(0, parentIndex));
      if (
        childTarget &&
        childTarget.unsetAttribute
      ) {
        childTarget.unsetAttribute(path.substring(parentIndex + 1));
      } else {
        _.unset(target, path);
      }
    } else {
      _.unset(target, path);
    }
  }

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
          // convert it
          _.set(data.target, nestedPoint.exactPath, {
            lat: nestedPoint.value.coordinates[1],
            lng: nestedPoint.value.coordinates[0]
          });

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
          // ge lng & lat
          let lat = nestedPoint.value.lat;
          let lng = nestedPoint.value.lng;

          // check if numbers are coming as string then we need to convert them
          if (typeof lat === 'string') {
            try {
              lat = parseFloat(lat);
            } catch (e) {
              // NOTHING
            }
          }
          if (typeof lng === 'string') {
            try {
              lng = parseFloat(lng);
            } catch (e) {
              // NOTHING
            }
          }

          // convert it
          _.set(data.target, nestedPoint.exactPath, {
            coordinates: [lng, lat],
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
          // check if we can use unsetAttribute to properly remove a loopback model property
          unsetProperty(data.target, nestedPoint.exactPath);
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

    // expose model methods
    Model.prepareDataForDB = prepareDataForDB;
    Model.prepareDataForRead = prepareDataForRead;
  }
};
