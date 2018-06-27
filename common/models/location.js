'use strict';

const app = require('../../server/server');

module.exports = function (Location) {

  // set flag to not get controller
  Location.hasController = true;

  /**
   * Get sub-locations for a list of locations. Result is an array of location IDs
   * @param parentLocations Array of location Ids for which to get the sublocations
   * @param allLocations Array on which to add the result; Must be an array of location IDs
   * @param callback
   */
  Location.getSubLocations = function (parentLocations, allLocations, callback) {
    // all locations include parent locations
    parentLocations.forEach(function (location) {
      if (allLocations.indexOf(location) === -1) {
        allLocations.push(location);
      }
    });
    // find children location
    Location
      .find({
        where: {
          parentLocationId: {
            in: parentLocations
          }
        }
      })
      .then(function (locations) {
        // if children locations found
        if (locations.length) {
          // store them
          const foundLocations = [];
          locations.forEach(function (location) {
            // avoid loops
            if (allLocations.indexOf(location.id) === -1) {
              foundLocations.push(location.id);
            } else {
              app.logger.warn(`Detected loop in location hierarchy: location with id "${location.id}" is set as a child location for a location that is lower the hierarchy. Scanned locations ids: ${allLocations.join(', ')}`)
            }
          });
          // consolidate them in the locations list
          allLocations = allLocations.concat(foundLocations);
          // scan their children
          Location.getSubLocations(foundLocations, allLocations, callback);
        } else {
          // no more locations found, stop here
          callback(null, allLocations);
        }
      })
      .catch(callback);
  };

  /**
   * Get sub-locations for a list of locations. Result is an array of location models
   * @param parentLocationsIds Array of location Ids for which to get the sublocations
   * @param allLocations Array on which to add the result; Must be an array of location models
   * @param callback
   */
  Location.getSubLocationsWithDetails = function (parentLocationsIds, allLocations, callback) {
    // get the location IDs from the allLocations array
    let allLocationsIds = allLocations.map(location => location.id);

    // get IDs of the parentLocations that are not in the allLocations array
    let notRetrievedParentLocationsIds = parentLocationsIds.filter(locationId => allLocationsIds.indexOf(locationId) === -1);

    // find not already retrieved parent locations as well as sublocations
    Location
      .find({
        where: {
          or: [{
            id: {
              in: notRetrievedParentLocationsIds
            }
          },
          {
            parentLocationId: {
              in: parentLocationsIds
            }
          }]
        }
      })
      .then(function (locations) {
        // if children locations found
        if (locations.length) {
          // store them
          let foundLocationsIds = [];
          locations.forEach(function (location) {
            // check if the retrieved location is not a searched parent location
            if (notRetrievedParentLocationsIds.indexOf(location.id) === -1) {
              // sublocation; avoid loops
              if (allLocationsIds.indexOf(location.id) === -1) {
                foundLocationsIds.push(location.id);
              } else {
                app.logger.warn(`Detected loop in location hierarchy: location with id "${location.id}" is set as a child location for a location that is lower the hierarchy. Scanned locations ids: ${allLocationsIds.join(', ')}`)
              }
            }
          });
          // consolidate them in the locations list
          allLocations = allLocations.concat(locations);
          // scan their children
          Location.getSubLocationsWithDetails(foundLocationsIds, allLocations, callback);
        } else {
          // no more locations found, stop here
          callback(null, allLocations);
        }
      })
      .catch(callback);
  };

  /**
   * Check that the model's identifiers (name and synonyms) are unique/contain unique elements,
   * in the context (between models with the same parentLocationId).
   */
  Location.validateModelIdentifiers = function (data, locationId) {
    /** If there is no parentLocationId (the location is a top tier location) make sure that mongoDB returns
     * only the locations with no parentLocationId field. If this conditional is not added and data.parentLocationId is undefined,
     * the query will just skip that condition which will return an incorrect data set.
     */
    let parentLocationQuery = data.parentLocationId;
    if (!data.parentLocationId) {
      parentLocationQuery = { eq: null }
    }

    /**
     * Just like above, we make sure to sanitize the synonyms query input
     */
    let synonymsQuery = data.synonyms;
    if (!data.synonyms) {
      synonymsQuery = [];
    }

    /**
     * This is a safety measure, in case the update request does not contain a `name` field.
     * This way we make sure the underlying query does not return erroneous data.
     */
    let nameQuery = data.name;
    if (!data.name) {
      nameQuery = '';
    }

    return Location.findOne({
      where: {
        id: {
          neq: locationId ? locationId : ''
        },
        parentLocationId: parentLocationQuery,
        or: [
          { name: nameQuery },
          {
            synonyms: {
              in: synonymsQuery
            }
          }
        ]
      }
    }).then((location) => {
      if (location) {
        /**
         * Create an error message that will identify all the invalid fields in the model.
         */
        let errors = [];

        if (location.name === data.name) {
          errors.push(`A location with name = '${data.name}' and the same parentLocationId already exists.`)
        }

        if (location.synonyms && data.synonyms) {
          data.synonyms.forEach((synonym) => {
            if(location.synonyms.indexOf(synonym) > -1) {
              errors.push(`A location with a '${synonym}' synonym and the same parentLocationId already exists.`);
            }
          })
        }

        throw(app.utils.apiError.getError("MODEL_IDENTIFIERS_ARE_NOT_UNIQUE_IN_CONTEXT", {model: Location.modelName, details: errors.join(' ')}));
      }
    })
  };

  /**
   * A location can be deleted only if all sub-locations have been deleted first. Assuming all the data is valid,
   * this check is done only for the direct sub-locations and not recurrently for all sub-locations.
   */
  Location.checkIfCanDelete = function (locationId) {
    return Location.findOne({
      where: {
        parentLocationId: locationId
      }
    }).then((location) => {
      if (location) {
        throw(app.utils.apiError.getError("DELETE_PARENT_MODEL", {model: Location.modelName}));
      }
    })
  };

  /**
   * A location can be deactivated only if all sub-locations have been deactivated first. Assuming all the data is valid,
   * this check is done only for the direct sub-locations and not recurrently for all sub-locations.
   */
  Location.checkIfCanDeactivate = function (data, locationId) {
    return Location.findOne({
      where: {
        parentLocationId: locationId,
        active: true
      }
    })
    .then((location) => {
      if (location) {
        throw(app.utils.apiError.getError("DEACTIVATE_PARENT_MODEL", {model: Location.modelName}));
      }
    })
  };
};
