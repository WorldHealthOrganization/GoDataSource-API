'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const async = require('async');
const escapeRegExp = require('../../components/escapeRegExp');

module.exports = function (Location) {

  // set flag to not get controller
  Location.hasController = true;

  // map language token labels for model properties
  Location.fieldLabelsMap = Object.assign({}, Location.fieldLabelsMap, {
    name: 'LNG_LOCATION_FIELD_LABEL_NAME',
    synonyms: 'LNG_LOCATION_FIELD_LABEL_SYNONYMS',
    identifiers: 'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS',
    'identifiers[].code': 'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS_CODE',
    'identifiers[].description': 'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS_DESC',
    active: 'LNG_LOCATION_FIELD_LABEL_ACTIVE',
    populationDensity: 'LNG_LOCATION_FIELD_LABEL_POPULATION_DENSITY',
    parentLocationId: 'LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION_ID',
    geoLocation: 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION',
    'geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    geographicalLevelId: 'LNG_LOCATION_FIELD_LABEL_GEOGRAPHICAL_LEVEL_ID'
  });

  Location.referenceDataFieldsToCategoryMap = {
    geographicalLevelId: 'LNG_REFERENCE_DATA_CATEGORY_LOCATION_GEOGRAPHICAL_LEVEL',
  };

  Location.referenceDataFields = Object.keys(Location.referenceDataFieldsToCategoryMap);

  // no location
  Location.noLocation = {
    id: '-',
    name: '-'
  };

  Location.arrayProps = {
    synonyms: 'LNG_LOCATION_FIELD_LABEL_SYNONYMS',
    identifiers: {
      code: 'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS_CODE',
      description: 'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS_DESC'
    }
  };

  /**
   * Get sub-locations for a list of locations. Result is an array of location IDs
   * @param parentLocations Array of location Ids for which to get the sublocations
   * @param allLocations Array on which to add the result; Must be an array of location IDs
   * @param callback
   */
  Location.getSubLocations = function (parentLocations, allLocations, callback) {
    // defensive checks
    if (!parentLocations) {
      parentLocations = [];
    }
    // all locations include parent locations
    parentLocations.forEach(function (location) {
      if (allLocations.indexOf(location) === -1) {
        allLocations.push(location);
      }
    });
    // find children location
    Location
      .rawFind({
        parentLocationId: {
          inq: parentLocations
        }
      }, {
        projection: {_id: 1}
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
              app.logger.warn(`Detected loop in location hierarchy: location with id "${location.id}" is set as a child location for a location that is lower the hierarchy. Scanned locations ids: ${allLocations.join(', ')}`);
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
   * @param loopbackFilter Loopback filter; used for projection
   * @param callback
   */
  Location.getSubLocationsWithDetails = function (parentLocationsIds, allLocations, loopbackFilter, callback) {
    // get the location IDs from the allLocations array
    let allLocationsIds = [];
    let allLocationsMap = {};
    allLocations.forEach(location => {
      allLocationsIds.push(location.id);
      allLocationsMap[location.id] = location;
    });

    // get IDs of the parentLocations that are not in the allLocations array
    let notRetrievedParentLocationsIds;
    if (Array.isArray(parentLocationsIds)) {
      // get IDs of the parentLocations that are not in the allLocations array
      notRetrievedParentLocationsIds = parentLocationsIds.filter(locationId => !allLocationsMap[locationId]);
    }

    // do not search for the locations already searched for
    let query = {
      id: {
        nin: allLocationsIds
      }
    };

    // include in the search locations that were not already found (if any)
    if (notRetrievedParentLocationsIds) {
      if (!query.or) {
        query.or = [];
      }
      query.or.push({
        id: {
          inq: notRetrievedParentLocationsIds
        }
      });
    }
    // include in the search parent locations, if any
    if (parentLocationsIds) {
      if (!query.or) {
        query.or = [];
      }
      query.or.push({
        parentLocationId: {
          inq: parentLocationsIds
        }
      });
    }

    // construct filter using loopback format
    let filter = {
      where: query,
      order: ['name ASC']
    };
    loopbackFilter.fields && (filter.fields = loopbackFilter.fields);

    // find not already retrieved parent locations as well as sublocations
    Location
      .rawFindWithLoopbackFilter(filter)
      .then(function (locations) {
        // if children locations found
        if (locations.length) {
          // store them
          let foundLocationsIds = [];
          locations.forEach(function (location) {
            // check if the retrieved location is not a searched parent location
            if (notRetrievedParentLocationsIds && notRetrievedParentLocationsIds.indexOf(location.id) === -1) {
              // sublocation; avoid loops
              if (!allLocationsMap[location.id]) {
                foundLocationsIds.push(location.id);
              } else {
                app.logger.warn(`Detected loop in location hierarchy: location with id "${location.id}" is set as a child location for a location that is lower the hierarchy. Scanned locations ids: ${allLocationsIds.join(', ')}`);
              }
            }
          });
          // consolidate them in the locations list
          allLocations = allLocations.concat(locations);
          // scan their children
          Location.getSubLocationsWithDetails(foundLocationsIds, allLocations, loopbackFilter, callback);
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
   * @param loopbackFilter Loopback filter; used for projection
   * @param callback
   */
  Location.getParentLocationsWithDetails = function (locationsIds, allLocations, loopbackFilter, callback) {
    // initialize array of IDs for locations that need to be retrieved
    let locationsToRetrieve = [];

    // retrieve the start locations if the locationIds are not found in the allLocations array
    // also retrieve the parent locations for the locationsIds that are found in allLocations array
    let startLocationsIdsToRetrieve = [];
    let parentLocationsIds = [];

    // create map for allLocations to avoid multiple searches in the array
    let allLocationsMap = {};
    allLocations.forEach(location => {
      allLocationsMap[location.id] = location;
    });

    locationsIds.forEach(function (locationId) {
      if (!allLocationsMap[locationId]) {
        // start location was not found in allLocations array; retrieve it
        startLocationsIdsToRetrieve.push(locationId);
      }
      // start location is already retrieved; retrieve parent if not already in the list
      else if (
        allLocationsMap[locationId].parentLocationId &&
        !allLocationsMap[allLocationsMap[locationId].parentLocationId]
      ) {
        parentLocationsIds.push(allLocationsMap[locationId].parentLocationId);
      }
    });

    // we need to retrieve both the start locations as well as their parents
    locationsToRetrieve = locationsToRetrieve.concat(startLocationsIdsToRetrieve, parentLocationsIds);

    // retrieve locations only if there are IDs missing
    let locationsToRetrievePromise = Promise.resolve([]);
    if (locationsToRetrieve.length) {
      // find not already retrieved locations
      let query = {
        where: {
          id: {
            inq: locationsToRetrieve
          }
        },
        order: ['name ASC']
      };
      loopbackFilter.fields && (query.fields = loopbackFilter.fields);
      locationsToRetrievePromise = Location
        .rawFindWithLoopbackFilter(query);
    }

    // find not already retrieved locations
    locationsToRetrievePromise
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
            if (
              parentLocationId &&
              !allLocationsMap[parentLocationId]
            ) {
              locationsIdsToRetrieveParent.push(location.id);
            }
          });
          // consolidate them in the locations list
          allLocations = allLocations.concat(locations);

          if (locationsIdsToRetrieveParent.length) {
            // go higher into the hierarchy
            Location.getParentLocationsWithDetails(locationsIdsToRetrieveParent, allLocations, loopbackFilter, callback);
          } else {
            // no need to continue searching
            callback(null, allLocations);
          }
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
  Location.validateModelIdentifiers = function (data, existingInstance) {
    // modify requests might not send all the fields in the request body
    // so we validate some fields using existing database instance values
    let parentLocationId = null;
    if (data.hasOwnProperty('parentLocationId')) {
      parentLocationId = data.parentLocationId || null;
    } else if (existingInstance) {
      parentLocationId = existingInstance.parentLocationId || null;
    }

    let name = '';
    if (data.hasOwnProperty('name')) {
      name = data.name || '';
    } else if (existingInstance) {
      name = existingInstance.name || '';
    }
    name = new RegExp(['^', escapeRegExp(name), '$'].join(''), 'i');

    let synonyms = [];
    if (data.hasOwnProperty('synonyms')) {
      synonyms = data.synonyms || [];
    } else if (existingInstance) {
      synonyms = existingInstance.synonyms || [];
    }
    synonyms = synonyms.map(item => new RegExp(['^', escapeRegExp(item), '$'].join(''), 'i'));

    let id = '';
    if (existingInstance) {
      id = existingInstance.id;
    }

    return Location.findOne({
      where: {
        id: {
          neq: id
        },
        parentLocationId: {
          eq: parentLocationId
        },
        or: [
          {
            name: name
          },
          {
            synonyms: {
              in: synonyms
            }
          }
        ]
      }
    }).then((location) => {
      if (location) {
        // create an error message that will identify all the invalid fields in the model.
        let errors = [];

        if (name.test(location.name)) {
          errors.push(`A location with name = '${location.name}' and the same parentLocationId already exists.`);
        }

        if (location.synonyms && synonyms) {
          synonyms.forEach((synonym) => {
            const synonymIndex = location.synonyms.findIndex(synonymToTest => synonym.test(synonymToTest));
            if (synonymIndex > -1) {
              errors.push(`A location with a '${location.synonyms[synonymIndex]}' synonym and the same parentLocationId already exists.`);
            }
          });
        }

        throw(app.utils.apiError.getError('MODEL_IDENTIFIERS_ARE_NOT_UNIQUE_IN_CONTEXT', {
          model: Location.modelName,
          details: errors.join(' ')
        }));
      }
    });
  };

  /**
   * A location can be deleted only if all sub-locations have been deleted first and location is not in use. Assuming all the data is valid,
   * this check is done only for the direct sub-locations and not recurrently for all sub-locations.
   */
  Location.checkIfCanDelete = function (locationId) {
    return Location
      .findOne({
        where: {
          parentLocationId: locationId
        }
      })
      .then((location) => {
        if (location) {
          throw(app.utils.apiError.getError('DELETE_PARENT_MODEL', {model: Location.modelName}));
        }
        return Location.isRecordInUse(locationId);
      })
      .then((recordInUse) => {
        if (recordInUse) {
          throw(app.utils.apiError.getError('MODEL_IN_USE', {
            model: Location.modelName,
            id: locationId
          }));
        }
      });
  };

  /**
   * A location can be deactivated only if all sub-locations have been deactivated first. Assuming all the data is valid,
   * this check is done only for the direct sub-locations and not recurrently for all sub-locations.
   */
  Location.checkIfCanDeactivate = function (data, locationId) {
    return Location
      .findOne({
        where: {
          parentLocationId: locationId,
          active: true
        }
      })
      .then((location) => {
        if (location) {
          throw(app.utils.apiError.getError('DEACTIVATE_PARENT_MODEL', {model: Location.modelName}));
        }
      });
  };


  /**
   * Build hierarchical list of locations
   * @param locationsList
   * @param [removeIdentifiers] {boolean} If true, id and parentLocationId are omitted from the record
   * @param baseLevel
   * @return {*[]}
   */
  Location.buildHierarchicalLocationsList = function (locationsList, removeIdentifiers, baseLevel) {
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

    /**
     * Convert a mongo point to a json point since loopback doesn't do it
     * @param location
     */
    function convertNestedGeoPointsToLatLng(location) {
      if (
        location.geoLocation &&
        location.geoLocation.coordinates &&
        location.geoLocation.coordinates[0] != null &&
        location.geoLocation.coordinates[1] != null
      ) {
        // convert it
        location.geoLocation = {
          lat: location.geoLocation.coordinates[1],
          lng: location.geoLocation.coordinates[0]
        };
      }
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
      if (
        location.parentLocationId == null || (
          location.geographicalLevelId !== undefined &&
          location.geographicalLevelId === baseLevel
        )
      ) {
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

          // process geopoint
          convertNestedGeoPointsToLatLng(currentLocation.location);

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
    // sort first level alphabetically (sub-levels are already sorted)
    hierarchicalLocationsList.sort(function (a, b) {
      return ((a.location.name === b.location.name) ? 0 : ((a.location.name > b.location.name) ? 1 : -1));
    });
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
    const syncLocationOperations = [];
    locationsList.forEach(
      function (location) {
        // build current location
        let _location = Object.assign({parentLocationId: parentLocationId}, location.location);
        // updatedAt is required for syncs
        if (!_location.updatedAt) {
          _location.updatedAt = new Date();
        }
        // add sync location operation
        syncLocationOperations.push(function (cb) {
          app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.location, _location, options)
            .then(function (syncedLocationResult) {
              const syncedLocation = syncedLocationResult.record;
              // store result
              options.resultAccumulator.push(syncedLocation);
              // when done, if there are other sub-locations
              if (location.children && location.children.length) {
                // create them recursively
                Location.createLocationsFromHierarchicalLocationsList(syncedLocation.id, location.children, options, cb);
              } else {
                // otherwise just stop
                cb(null, syncedLocation);
              }
            })
            .catch(cb);
        });
      }
    );
    // run create operations
    async.series(syncLocationOperations, function (error) {
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
        return callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
          contentType: 'JSON',
          details: 'it should contain an array'
        }));
      }
      // create locations from the hierarchical list
      Location.createLocationsFromHierarchicalLocationsList(undefined, locations, options, callback);
    } catch (error) {
      // handle JSON.parse errors
      callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
        contentType: 'JSON',
        details: error.message
      }));
    }
  };

  /**
   * Do not allow the creation of a location with a name/synonyms that is not unique in the same context
   * @param ctx
   * @param next
   */
  Location.observe('before save', function (ctx, next) {
    if (ctx.isNewInstance) {
      Location.validateModelIdentifiers(ctx.instance.toJSON())
        .then(() => next())
        .catch(next);
    } else {
      Location.validateModelIdentifiers(ctx.data, ctx.currentInstance)
        .then(() => {
          if (ctx.data.active === false) {
            return Location.checkIfCanDeactivate(ctx.data, ctx.currentInstance.id);
          }
        })
        .then(() => next())
        .catch((error) => next(error));
    }
  });

  /**
   * Do not allow the deletion of a location if it still has sub-locations
   * @param ctx
   * @param next
   */
  Location.observe('before delete', function (ctx, next) {
    Location.checkIfCanDelete(ctx.currentInstance.id)
      .then(() => next())
      .catch(next);
  });

  /**
   * Creates a map that links all child locations (from all sub-levels) to their reporting level parent location
   * @param locationHierarchy
   * @param reportingLocationIds
   * @param locationCorelationMap (this parameter gets updated during the function call)
   */
  Location.createLocationCorelationMap = function (locationHierarchy, reportingLocationIds, locationCorelationMap) {
    locationHierarchy.forEach((topLevel) => {
      if (reportingLocationIds.includes(topLevel.location.id)) {
        locationCorelationMap[topLevel.location.id] = topLevel.location.id;
        if (topLevel.children.length !== 0) {
          Location.linkAllChildrenToTopLevel(topLevel.children, topLevel.location.id, locationCorelationMap);
        }
      } else {
        if (topLevel.children.length) {
          Location.createLocationCorelationMap(topLevel.children, reportingLocationIds, locationCorelationMap);
        }
      }
    });
  };

  /**
   * Link all children from a location hierarchy to a specified reporting level location
   * @param locationHierarchy
   * @param id
   * @param locationCorelationMap (this parameter gets updated during the function call)
   */
  Location.linkAllChildrenToTopLevel = function (locationHierarchy, id, locationCorelationMap) {
    locationHierarchy.forEach((location) => {
      locationCorelationMap[location.location.id] = id;
      if (location.children.length) {
        Location.linkAllChildrenToTopLevel(location.children, id, locationCorelationMap);
      }
    });
  };

  /**
   * Resolve a list of location by taking into consideration the geographic level
   * @param locationIds
   * @param outbreakOpts Outbreak location options: locationIds, reportingGeographicalLevelId
   */
  Location.resolveLocationsWithLevel = function (locationIds, outbreakOpts) {
    // application model's reference
    const models = app.models;

    return new Promise((resolve, reject) => {
      // outbreak locations filter
      let outbreakLocations;
      // update filter only if outbreak has locations ids defined (otherwise leave it as undefined)
      if (Array.isArray(outbreakOpts.locationIds) && outbreakOpts.locationIds.length) {
        // get outbreak location ids
        outbreakLocations = outbreakOpts.locationIds;
      }

      // avoid making secondary request to DB by using a collection of locations instead of an array of locationIds
      return models.location.getSubLocationsWithDetails(outbreakLocations, [], {}, function (error, allLocations) {
        let allLocationIds = allLocations.map((location) => location.id);

        // reportingGeographicalLevelId should be required in the model schema as well but it is not yet implemented
        // that way because it would be a breaking change
        let outbreakLevelId = outbreakOpts.reportingGeographicalLevelId;
        if (!outbreakLevelId) {
          return reject(app.utils.apiError.getError('MISSING_REQUIRED_PROPERTY', {
            model: models.outbreak.modelName,
            properties: 'reportingGeographicalLevelId'
          }));
        }

        // Get all locations that are part of the outbreak's location hierarchy and have the
        // same location level as the outbreak
        return models.location
          .find({
            where: {
              and: [
                {
                  id: {
                    inq: allLocationIds
                  }
                },
                {
                  geographicalLevelId: outbreakLevelId
                }
              ]
            }
          })
          .then((reportingLocations) => {
            let reportingLocationIds = reportingLocations.map((location) => location.id);
            let locationHierarchy = models.location.buildHierarchicalLocationsList(allLocations);
            let locationCorrelationMap = {};

            // link lower level locations to their reporting location parent
            app.models.location.createLocationCorelationMap(locationHierarchy, reportingLocationIds, locationCorrelationMap);

            // lookup passed location ids into correlation map
            let resolvedLocationsMap = {};
            locationIds.forEach((locationId) => {
              let resolvedLocationId = locationCorrelationMap[locationId];
              if (resolvedLocationId) {
                resolvedLocationsMap[locationId] = resolvedLocationId;
              }
            });

            return resolve(resolvedLocationsMap);
          });
      });
    });
  };
};
