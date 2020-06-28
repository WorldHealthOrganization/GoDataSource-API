'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with location related actions
 */

const app = require('../../server/server');

module.exports = function (Outbreak) {
  /**
   * Get hierarchical locations list for an outbreak
   * @param filter Besides the default filter properties this request also accepts 'includeChildren' boolean on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.getLocationsHierarchicalList = function (filter, options, callback) {
    // define a list of location IDs used at outbreak level
    let outbreakLocationIds;
    // if the outbreak has a list of locations defined (if is empty array, then is not set)
    if (Array.isArray(this.locationIds) && this.locationIds.length) {
      // get them
      outbreakLocationIds = this.locationIds;
    }

    // get user allowed locations IDs
    app.user.helpers
      .getUserAllowedLocationsIds(options.remotingContext)
      .then(userAllowedLocationsIds => {
        // if neither outbreak or user have location restrictions
        if (!outbreakLocationIds && !userAllowedLocationsIds) {
          // use global (unrestricted) locations hierarchical list
          return app.controllers.location.getHierarchicalList(filter, callback);
        }

        // there are locations restrictions; either from outbreak or user or both
        let allowedLocationsIds;
        if (outbreakLocationIds && !userAllowedLocationsIds) {
          // only outbreak has restrictions
          allowedLocationsIds = outbreakLocationIds;
        } else if (!outbreakLocationIds && userAllowedLocationsIds) {
          // only user has restrictions
          allowedLocationsIds = userAllowedLocationsIds;
        } else {
          // both have restrictions; use intersection

        }

        // initialize includeChildren filter
        let includeChildren;
        // check if the includeChildren filter was sent; accepting it only on the first level
        includeChildren = _.get(filter, 'where.includeChildren');
        if (typeof includeChildren !== 'undefined') {
          // includeChildren was sent; remove it from the filter as it shouldn't reach DB
          delete filter.where.includeChildren;
        } else {
          // default value is true
          includeChildren = true;
        }

        // get the allowed location IDs for the outbreak
        const getAllowedLocationsCallback = function (error, allowedLocationIds) {
          // handle eventual errors
          if (error) {
            return callback(error);
          }
          // build an index for allowed locations (to find them faster)
          const allowedLocationsIndex = {};
          allowedLocationIds.forEach(function (locationId) {
            allowedLocationsIndex[locationId] = true;
          });

          // build the filter
          const _filter = app.utils.remote.mergeFilters({
            where: {
              id: {
                inq: allowedLocationIds
              }
            }
          }, filter || {});

          // set the includeChildren back on the first level of where (where the getHierarchicalList expects it to be)
          _.set(_filter, 'where.includeChildren', includeChildren);

          // build hierarchical list of locations, restricting locations to the list of allowed ones
          return app.controllers.location.getHierarchicalList(
            _filter,
            function (error, hierarchicalList) {
              // handle eventual errors
              if (error) {
                return callback(error);
              }
              // starting from the top, disable locations that are above the allowed locations
              // hierarchical list will show all parent locations, even the ones above the selected level, mark those as disabled
              (function disableDisallowedLocations(locationsList) {
                // if there are locations to process
                if (locationsList.length) {
                  // go through all of them
                  locationsList.forEach(function (location) {
                    // the location is not one of the allowed ones
                    if (!allowedLocationsIndex[location.location.id]) {
                      // mark it as disabled
                      location.location.disabled = true;
                      // continue checking children
                      if (Array.isArray(location.children)) {
                        disableDisallowedLocations(location.children);
                      }
                    }
                  });
                }
              })(hierarchicalList);
              // return processed hierarchical location list
              callback(null, hierarchicalList);
            });
        };

        // if we need to include children the allowed locations will also include the children
        // else the allowed locations are just the outbreak locations
        if (includeChildren) {
          app.models.location.getSubLocations(outbreakLocationIds, [], getAllowedLocationsCallback);
        } else {
          getAllowedLocationsCallback(null, outbreakLocationIds);
        }
      })
      .catch(callback);
  };
};
