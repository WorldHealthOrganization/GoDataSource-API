'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const async = require('async');

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
          or: [
            {
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
      parentLocationQuery = {eq: null}
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
          {name: nameQuery},
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
            if (location.synonyms.indexOf(synonym) > -1) {
              errors.push(`A location with a '${synonym}' synonym and the same parentLocationId already exists.`);
            }
          })
        }

        throw(app.utils.apiError.getError("MODEL_IDENTIFIERS_ARE_NOT_UNIQUE_IN_CONTEXT", {
          model: Location.modelName,
          details: errors.join(' ')
        }));
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


  /**
   * Build hierarchical list of locations
   * @param locationsList
   * @return {*[]}
   */
  Location.buildHierarchicalLocationsList = function (locationsList) {

    /**
     * Update indices for children locations (under new parentLocationPath)
     * @param location
     * @param locationIndex
     * @param parentLocationPath
     */
    function updateChildrenLocationIndex(location, locationIndex, parentLocationPath) {
      // go trough all children
      location.children.forEach(function (child, index) {
        // move the child under the new parent path
        let updatedIndex = `${parentLocationPath}.children.${index}`;
        // update index
        locationIndex[child.location.id] = updatedIndex;
        // if there are grand-children
        if (child.children.length) {
          // process them
          updateChildrenLocationIndex(child, locationIndex, updatedIndex);
        }
      });
    }

    // store a hierarchical list of locations
    let hierarchicalLocationsList = [];
    // index position for each element for easy referencing
    let locationIndex = {};
    // keep a list of un processed entities items that were not yet processed to final position
    let unprocessedLocations = {};

    // go through all locations
    locationsList.forEach(function (location) {
      // if the location is an instance
      if (location.toJSON) {
        // transform it to JSON
        location = location.toJSON();
      }
      // define length (it will be used later)
      let length;
      // keep a flag for just processed locations
      let justProcessed = false;
      // if the location was found in unprocessed locations
      if (unprocessedLocations[location.id]) {
        // update location information (process it)
        _.set(hierarchicalLocationsList, `${locationIndex[location.id]}.location`, location);
        // delete it from the unprocessed list
        delete unprocessedLocations[location.id];
        // and mark it as just processed
        justProcessed = true;
      }

      // if this is a top level location
      if (location.parentLocationId == null) {
        // if it was not just processed
        if (!justProcessed) {
          // add it to the list on the top level
          length = hierarchicalLocationsList.push({
            location: location,
            children: []
          });
          // store its index
          locationIndex[location.id] = length - 1;
        }
      } else {
        // not a top level location and it's parent was indexed
        if (locationIndex[location.parentLocationId] !== undefined) {
          // get parent location
          const parentLocation = _.get(hierarchicalLocationsList, locationIndex[location.parentLocationId]);
          // build current location
          let currentLocation = {
            location: location,
            children: []
          };
          // if it was just processed
          if (justProcessed) {
            // get location instance
            currentLocation = JSON.parse(JSON.stringify(_.get(hierarchicalLocationsList, locationIndex[location.id])));
            // remove it from where it previously was in the list (will be moved under parent location)
            _.set(hierarchicalLocationsList, locationIndex[location.id], null);
          }
          // add it under parent location
          length = parentLocation.children.push(currentLocation);
          // store its index
          locationIndex[location.id] = `${locationIndex[location.parentLocationId]}.children.${length - 1}`;
          // for just processed locations
          if (justProcessed) {
            // update children maps (location indexes)
            updateChildrenLocationIndex(currentLocation, locationIndex, locationIndex[location.id]);
          }
        } else {
          // not a top level location and we cannot locate its parent, mark it as unprocessed entity
          unprocessedLocations[location.parentLocationId] = true;
          // add it to the hierarchical list, as a child of an unprocessed parent
          length = hierarchicalLocationsList.push({
            location: null,
            children: [
              {
                location: location,
                children: []
              }
            ]
          });
          // set unprocessed parent location index
          locationIndex[location.parentLocationId] = length - 1;
          // set unprocessed location index
          locationIndex[location.id] = `${length - 1}.children.0`;
        }
      }
    });
    // remove empty items (items that were processed later) and unprocessed items (orphaned items whose parents are not found)
    hierarchicalLocationsList = hierarchicalLocationsList.filter(item => item && item.location);
    // return built list
    return hierarchicalLocationsList;
  };

  /**
   * Create locations from a hierarchical locations list
   * @param parentLocationId
   * @param locationsList
   * @param callback
   */
  Location.createLocationsFromHierarchicalLocationsList = function (parentLocationId, locationsList, callback) {
    // build a list of create operations
    const createLocationOperations = [];
    locationsList.forEach(function (location) {
        // build current location
        let _location = Object.assign({parentLocationId: parentLocationId}, location.location);
        // add create location operation
        createLocationOperations.push(function (cb) {
          Location
            .create(_location)
            .then(function (createdLocation) {
              // when done, if there are other sub-locations
              if (location.children && location.children.length) {
                // create them recursively
                Location.createLocationsFromHierarchicalLocationsList(createdLocation.id, location.children, cb);
              } else {
                // otherwise just stop
                cb();
              }
            })
            .catch(cb)
        });
      }
    );
    // run create operations
    async.series(createLocationOperations, callback);
  };
};
