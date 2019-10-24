'use strict';

const _ = require('lodash');

/**
 * Convert nested geo points filters to mongo
 * @param Model
 * @param loopbackWhere
 * @return {any} A new filter ( doesn't change the old one )
 */
function convert(
  Model,
  loopbackWhere,
  dontClone,
  listOfGeoPoints
) {
  // nothing to change ?
  const newWhere = dontClone ? loopbackWhere : _.cloneDeep(loopbackWhere);
  if (_.isEmpty(Model.nestedGeoPoints)) {
    return newWhere;
  }

  // construct list of possible geo points filter properties for our model
  if (!listOfGeoPoints) {
    listOfGeoPoints = [];
    Model.nestedGeoPoints.forEach((property) => {
      listOfGeoPoints.push(property);
      if (property.indexOf('[]') > -1) {
        listOfGeoPoints.push(property.replace(/\[]/g, ''));
      }
    });
  }

  // replace filter geo points conditions with mongo conditions
  if (
    _.isObject(newWhere) ||
    _.isArray(newWhere)
  ) {
    // go through each property and check if it this one is a nested geo point
    _.each(
      newWhere,
      (value, key) => {
        // get current value and path
        if (
          typeof key === 'string' &&
          listOfGeoPoints.includes(key)
        ) {
          // check if we need to replace filter prop
          if (
            _.isObject(value) &&
            value.near
          ) {
            // add mongo near search criteria
            if (
              value.near &&
              value.near.lat !== undefined &&
              value.near.lng !== undefined
            ) {
              value.$near = {
                $geometry: {
                  type: 'Point',
                  coordinates: [
                    typeof value.near.lng === 'string' ?
                      parseFloat(value.near.lng) :
                      value.near.lng,
                    typeof value.near.lat === 'string' ?
                      parseFloat(value.near.lat) :
                      value.near.lat
                  ]
                }
              };
            } else {
              // either lat & lng are missing, or already a mongo filter
              // in case lat & lng are missing then this will throw an error which is okay because this means that we have a bug somewhere
              value.$near = value.near;
            }

            // add distance limits
            if (value.$near) {
              if (value.maxDistance !== undefined) {
                value.$near.$maxDistance = typeof value.maxDistance === 'string' ?
                  parseFloat(value.maxDistance) :
                  value.maxDistance;
              }
              if (value.minDistance !== undefined) {
                value.$near.$minDistance = typeof value.minDistance === 'string' ?
                  parseFloat(value.minDistance) :
                  value.minDistance;
              }
            }

            // remove loopback search criteria
            delete value.near;
            delete value.maxDistance;
            delete value.minDistance;
          }
        } else {
          newWhere[key] = convert(
            Model,
            value,
            true,
            listOfGeoPoints
          );
        }
      }
    );
  } else {
    // there is nothing to do since we've already cloned it
  }

  // finished
  return newWhere;
}

module.exports = convert;
