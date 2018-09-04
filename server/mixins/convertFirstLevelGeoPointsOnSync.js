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
 * Convert first level GeoPoints to valid Loopback GeoPoint on sync action
 * On sync the GeoPoint is received as it is saved in the DB (contains coordinates)
 * Loopback expects lat/lng instead of coordinates and breaks
 * This mixin coverts coordinates to lat/lng before save
 * @param Model
 */
module.exports = function (Model) {

  /**
   * Convert MongoDB format to Loopback format
   * @param context
   */
  function prepareDataForLoopback(context) {
    // the preparing of data must be done only on sync action
    if(context._sync) {
      // get data source and target from context
      const data = getSourceAndTargetFromContext(context);

      // convert each first level GeoPoint
      geoPointProperties.forEach(function (property) {
        // get current value and path
        let geoPoint = app.utils.helpers.getReferencedValue(data.source, property);

        // always works with same data type (simplify logic)
        if (!Array.isArray(geoPoint)) {
          geoPoint = [geoPoint];
        }
        // go through each GeoPoint
        geoPoint.forEach(function (point) {
          // if the GeoPoint is not in the desired format
          if (
            point.value &&
            point.value.coordinates &&
            point.value.lng === undefined &&
            point.value.lat === undefined
          ) {
            // convert it
            _.set(data.target, point.exactPath, {
              lat: point.value.coordinates[1],
              lng: point.value.coordinates[0]
            });
          }
        });
      });
    }
  }

  // get list of properties and check if there are any that would require parsing on sync (geopoint properties)
  let modelProperties = Model.definition.rawProperties;
  let geoPointProperties = Object.keys(modelProperties).filter(property => modelProperties[property].type === 'geopoint');

  // if model definition contains first level GeoPoints
  if (geoPointProperties.length) {

    Model.observe('before save', function convertToLoopback(context, next) {
      prepareDataForLoopback(context);
      next();
    });
  }
};
