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
   * Get parent locations for a list of locations. Result is an array of location models
   * Result also includes the models with IDs in locationsIds
   * @param locationsIds Array of location Ids for which to get the parent locations recursively
   * @param allLocations Array on which to add the result; Must be an array of location models
   * @param callback
   */
  Location.getParentLocationsWithDetails = function (locationsIds, allLocations, callback) {
    // initialize array of IDs for locations that need to be retrieved
    let locationsToRetrieve = [];

    // retrieve the start locations if the locationIds are not found in the allLocations array
    // also retrieve the parent locations for the locationsIds that are found in allLocations array
    let startLocationsIdsToRetrieve = [];
    let parentLocationsIds = [];
    locationsIds.forEach(function (locationId) {
      let index = allLocations.findIndex(location => location.id === locationId);
      if (index === -1) {
        // start location was not found in allLocations array; retrieve it
        startLocationsIdsToRetrieve.push(locationId);
      }
      // start location is already retrieved; retrieve parent if not already in the list
      else if(allLocations.findIndex(location => location.id === allLocations[index].parentLocationId) === -1) {
        parentLocationsIds.push(allLocations[index].parentLocationId);
      }
    });

    // we need to retrieve both the start locations as well as their parents
    locationsToRetrieve = locationsToRetrieve.concat(startLocationsIdsToRetrieve, parentLocationsIds);

    // find not already retrieved locations
    Location
      .find({
        where: {
          id: {
            in: locationsToRetrieve
          }
        }
      })
      .then(function (locations) {
        // if locations found
        if (locations.length) {
          // initialize array of location IDs for which the parent still needs to be found
          // will be composed of all retrieved locations IDs except the ones for which the parent is already retrieved
          let locationsIdsToRetrieveParent = [];

          locations.forEach(function (location) {
            // get parentLocationId
            let parentLocationId = location.parentLocationId;

            // check if the parent location already exists in allLocations; if so do not retrieve it again.
            if (allLocations.findIndex(location => location.id === parentLocationId) === -1) {
              locationsIdsToRetrieveParent.push(location.id);
            }
          });
          // consolidate them in the locations list
          allLocations = allLocations.concat(locations);
          // go higher into the hierarchy
          Location.getParentLocationsWithDetails(locationsIdsToRetrieveParent, allLocations, callback);
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
   * @param [removeIdentifiers] {boolean} If true, id and parentLocationId are omitted from the record
   * @return {*[]}
   */
  Location.buildHierarchicalLocationsList = function (locationsList, removeIdentifiers) {
    // by default keep identifiers
    if (removeIdentifiers === undefined) {
      removeIdentifiers = false;
    }

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
      // clone location (in order to modify it without altering the source)
      let locationToStore = Object.assign({}, location);
      // check if identifiers should be removed
      if (removeIdentifiers) {
        delete locationToStore.id;
        delete locationToStore.parentLocationId;
      }
      // define length (it will be used later)
      let length;
      // keep a flag for just processed locations
      let justProcessed = false;
      // if the location was found in unprocessed locations
      if (unprocessedLocations[location.id]) {
        // update location information (process it)
        _.set(hierarchicalLocationsList, `${locationIndex[location.id]}.location`, locationToStore);
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
            location: locationToStore,
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
            location: locationToStore,
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

          // initialize location entry
          let currentLocation = {
            location: locationToStore,
            children: []
          };

          // when the entry is just processed need to get it as its index will change
          if (justProcessed) {
            currentLocation = JSON.parse(JSON.stringify(_.get(hierarchicalLocationsList, `${locationIndex[location.id]}`)));
            // remove it from current index
            _.set(hierarchicalLocationsList, locationIndex[location.id], null);
          }

          // add it to the hierarchical list, as a child of an unprocessed parent
          length = hierarchicalLocationsList.push({
            location: null,
            children: [
              currentLocation
            ]
          });

          // set unprocessed parent location index
          locationIndex[location.parentLocationId] = length - 1;
          locationIndex[location.id] = `${length - 1}.children.0`;
          // if the location was just processed after updating its index also update its children indexes
          if (justProcessed) {
            updateChildrenLocationIndex(currentLocation, locationIndex, locationIndex[location.id]);
          }
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
   * @param [options]
   * @param callback
   */
  Location.createLocationsFromHierarchicalLocationsList = function (parentLocationId, locationsList, options, callback) {
    // options is a optional params
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    // gather all results under one accumulator
    if (!options.resultAccumulator) {
      options.resultAccumulator = [];
    }

    // build a list of create operations
    const createLocationOperations = [];
    locationsList.forEach(function (location) {
        // build current location
        let _location = Object.assign({parentLocationId: parentLocationId}, location.location);
        // add create location operation
        createLocationOperations.push(function (cb) {
          Location
            .create(_location, options)
            .then(function (createdLocation) {
              // store result
              options.resultAccumulator.push(createdLocation);
              // when done, if there are other sub-locations
              if (location.children && location.children.length) {
                // create them recursively
                Location.createLocationsFromHierarchicalLocationsList(createdLocation.id, location.children, options, cb);
              } else {
                // otherwise just stop
                cb(null, createdLocation);
              }
            })
            .catch(cb)
        });
      }
    );
    // run create operations
    async.series(createLocationOperations, function (error) {
      if (error) {
        return callback(error);
      }
      callback(null, options.resultAccumulator);
    });
  };

  /**
   * Import hierarchical locations list from JSON file
   * @param fileContent
   * @param options
   * @param callback
   * @return {*}
   */
  Location.importHierarchicalListFromJsonFile = function (fileContent, options, callback) {
    // try and parse JSON file content
    try {
      const locations = typeof fileContent === 'string' ? JSON.parse(fileContent) : fileContent;
      // this needs to be a list (in order to get its headers)
      if (!Array.isArray(locations)) {
        // error invalid content
        return callback(app.utils.apiError.getError("INVALID_CONTENT_OF_TYPE", {
          contentType: 'JSON',
          details: 'it should contain an array'
        }));
      }
      // create locations from the hierarchical list
      Location.createLocationsFromHierarchicalLocationsList(undefined, locations, options, callback);
    } catch (error) {
      // handle JSON.parse errors
      callback(app.utils.apiError.getError("INVALID_CONTENT_OF_TYPE", {
        contentType: 'JSON',
        details: error.message
      }));
    }
  };
};
