'use strict';

const app = require('../../server/server');
const fs = require('fs');
const _ = require('lodash');
const async = require('async');
const apiError = require('./../../components/apiError');
const Platform = require('../../components/platform');
const Config = require('../../server/config.json');
const importableFile = require('./../../components/importableFile');
const genericHelpers = require('../../components/helpers');
const uuid = require('uuid').v4;

const locationImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (Location) {

  /**
   * Export hierarchical locations list
   * @param callback
   */
  Location.exportHierarchicalList = function (filter, callback) {
    Location
      .find({
        // blacklist some fields in the export
        fields: {
          dbUpdatedAt: false
        },
        deleted: filter && filter.where && filter.where.includeDeletedLocations ?
          true :
          undefined,
        order: ['name ASC', 'parentLocationId ASC', 'id ASC']
      })
      .then(function (locations) {
        app.utils.remote.helpers
          .offerFileToDownload(
            JSON.stringify(
              Location.buildHierarchicalLocationsList(
                locations,
                undefined,
                undefined,
                filter && filter.where && filter.where.replaceUpdatedAtAsCurrentDate
              ),
              null,
              2
            ),
            'application/json',
            'locations.json',
            callback
          );
      }).catch(callback);
  };

  /**
   * Get hierarchical locations list
   * @param filter Besides the default filter properties this request also accepts 'includeChildren' boolean on the first level in 'where'
   * @param callback
   */
  Location.getHierarchicalList = function (filter = {}, callback) {
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

    // check for sent fields
    if (filter.fields) {
      // ensure that properties required in logic are requested from db
      filter.fields = new Array(...new Set(filter.fields.concat(['id', 'parentLocationId'])));
    }

    // initialize logic location filter
    let logicLocationFilter = {
      order: ['name ASC', 'parentLocationId ASC', 'id ASC']
    };
    // initialize flag in order to not repeat the same checks below in code
    let getOtherLocationsForHierarchicalList = true;
    // if there is no query sent we will not need to retrieve other locations in order to construct the hierarchy
    // as we will either retrieve all locations or depending on includeChildren flag we will just retrieve top level locations
    if (
      !filter ||
      !filter.where ||
      !Object.keys(filter.where).length
    ) {
      // set flag to know that we will not need to make other location queries
      getOtherLocationsForHierarchicalList = false;

      if (!includeChildren) {
        // we don't need to include children we will just retrieve top level locations
        logicLocationFilter.where = {
          parentLocationId: null
        };
      }
    }

    Location
      .rawFindWithLoopbackFilter(app.utils.remote
        .mergeFilters(logicLocationFilter, filter || {}))
      .then(function (locations) {
        if (!getOtherLocationsForHierarchicalList) {
          // construct hierarchy only with the found locations
          return callback(null, Location.buildHierarchicalLocationsList(locations));
        }

        // we need to retrieve the other locations to construct the needed hierarchy
        // get found locations IDs
        let foundLocationsIDs = locations.map(location => location.id);

        // check for includeChildren flag
        if (includeChildren) {
          // we need to get children; first get the children and then get the not already found parents;
          // the other way around would get all the children (not needed) for parents of the locations that we actually need
          return Location.getSubLocationsWithDetails(foundLocationsIDs, locations, filter, function (error, locationsWithChildren) {
            if (error) {
              return callback(error);
            }

            let locationsIDs = locationsWithChildren.map(location => location.id);

            // get parent locations
            return Location.getParentLocationsWithDetails(locationsIDs, locationsWithChildren, filter, function (error, locationsWithParents) {
              if (error) {
                return callback(error);
              }

              callback(null, Location.buildHierarchicalLocationsList(locationsWithParents));
            });
          });
        } else {
          // get parent locations
          Location.getParentLocationsWithDetails(foundLocationsIDs, locations, filter, function (error, locationsWithParents) {
            if (error) {
              return callback(error);
            }

            callback(null, Location.buildHierarchicalLocationsList(locationsWithParents));
          });
        }
      })
      .catch(callback);
  };

  /**
   * Import a hierarchical list (JSON) of locations
   * @param req
   * @param file This is doc-only, loopback cannot parse multi-part payload.
   * @param options
   * @param callback
   */
  Location.importHierarchicalList = function (req, file, options, callback) {
    // inject platform identifier
    options = options || {};
    options.platform = Platform.IMPORT;

    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['file'], Location, [], function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // read the file
      fs.readFile(files.file.path, function (error, buffer) {
        if (error) {
          return callback(apiError.getError('FILE_NOT_FOUND'));
        }
        // import locations
        Location.importHierarchicalListFromJsonFile(buffer.toString(), options, callback);
      });
    });
  };

  /**
   * Import an importable file using file ID and a map to remap parameters
   * @param body
   * @param options
   * @param callback
   */
  Location.importImportableFileUsingMap = function (body, options, callback) {
    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // inject platform identifier
    options.platform = Platform.IMPORT;

    /**
     * Create array of actions that will be executed in series/parallel for each batch
     * Note: Failed items need to have success: false and any other data that needs to be saved on error needs to be added in a error container
     * @param {Array} batchData - Batch data
     * @returns {[]}
     */
    const createBatchActions = function (batchData) {
      // build a list of sync operations
      const syncLocation = [];

      // go through all batch entries
      batchData.forEach(function (locationItem) {
        syncLocation.push(function (asyncCallback) {
          // sync location
          return app.utils.dbSync.syncRecord(app, logger, app.models.location, locationItem.save, options)
            .then(function () {
              asyncCallback();
            })
            .catch(function (error) {
              asyncCallback(null, {
                success: false,
                error: {
                  error: error,
                  data: {
                    file: locationItem.raw,
                    save: locationItem.save
                  }
                }
              });
            });
        });
      });

      return syncLocation;
    };

    // pre-validate
    const preBatchValidator = (
      batchData,
      processed
    ) => {
      return Promise.resolve()
        .then(() => {
          // determine missing parentLocationId for those records that might be updates
          const missingParentsForLocationIds = [];
          batchData.forEach((data) => {
            if (
              data.save.id &&
              !data.save.parentLocationId
            ) {
              missingParentsForLocationIds.push(data.save.id);
            }
          });

          // nothing to do ?
          if (missingParentsForLocationIds.length < 1) {
            return;
          }

          // retrieve locations
          return app.dataSources.mongoDb.connector
            .collection('location')
            .find(
              {
                _id: {
                  $in: missingParentsForLocationIds
                }
              }, {
                projection: {
                  _id: 1,
                  parentLocationId: 1
                }
              }
            )
            .toArray()
            .then((missingParentsLocations) => {
              // map locations
              const missingParentsLocationMap = {};
              missingParentsLocations.forEach((locationData) => {
                missingParentsLocationMap[locationData._id] = locationData;
              });

              // add missing parent ids
              batchData.forEach((data) => {
                // nothing to do ?
                if (
                  !data.save.id ||
                  data.save.parentLocationId ||
                  !missingParentsLocationMap[data.save.id] ||
                  !missingParentsLocationMap[data.save.id].parentLocationId
                ) {
                  return;
                }

                // set parent
                data.save.parentLocationId = missingParentsLocationMap[data.save.id].parentLocationId;
              });
            });
        })
        .then(() => {
          // convert to expected format
          const processedLocationsMap = {};
          const groupsMap = {};
          batchData.forEach((data, index) => {
            // initialize ID ?
            if (!data.save.id) {
              data.save.id = uuid();
            }

            // attach to parent
            if (data.save.parentLocationId) {
              // must initialize parent ?
              if (!groupsMap[data.save.parentLocationId]) {
                // we need it to check for duplicate names && synonyms
                groupsMap[data.save.parentLocationId] = {
                  childrenIds: [data.save.id]
                };
              } else {
                groupsMap[data.save.parentLocationId].childrenIds.push(data.save.id);
              }
            } else {
              // root location
              if (!groupsMap[null]) {
                // we need it to check for duplicate names && synonyms
                groupsMap[null] = {
                  childrenIds: [data.save.id]
                };
              } else {
                groupsMap[null].childrenIds.push(data.save.id);
              }
            }

            // initialize processed location ?
            const recordNo = processed + index + 1;
            if (!processedLocationsMap[data.save.id]) {
              processedLocationsMap[data.save.id] = {
                locations: [{
                  recordNo,
                  location: data.save
                }]
              };
            } else {
              processedLocationsMap[data.save.id].locations.push({
                recordNo,
                location: data.save
              });
            }
          });

          // validate
          return app.models.location.preImportValidation(
            processedLocationsMap,
            groupsMap
          );
        });
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.location,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.location,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'location',
      batchSize: locationImportBatchSize,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.location.modelName,
      logger: logger,
      parallelActionsLimit: 10
    }, formatterOptions, createBatchActions, callback, preBatchValidator);
  };

  /**
   * Get usage for a location entry
   * @param filter
   * @param callback
   */
  Location.prototype.getUsage = function (filter, callback) {
    Location.getSubLocations([this.id], [], (err, locations) => {
      if (err) {
        return callback(err);
      }

      Location.findModelUsage(locations, filter, false)
        .then(function (usage) {
          callback(null, usage);
        })
        .catch(callback);
    });
  };

  /**
   * Count usage for a location entry
   * @param where
   * @param callback
   */
  Location.prototype.countUsage = function (where, callback) {
    Location
      .findModelUsage(this.id, {where: where}, true)
      .then(function (results) {
        callback(null,
          // count all of the results
          Object.values(results).reduce(function (a, b) {
            return a + b;
          }));
      })
      .catch(callback);
  };

  /**
   * Propagate location GeoLocation to linked people that do not have manually added geo-location (geoLocationAccurate: false)
   * @param options
   * @param callback
   * @returns {*}
   */
  Location.prototype.propagateGeoLocationToLinkedPeople = function (options, callback) {
    const self = this;
    // sanity check
    if (!this.geoLocation) {
      return callback(app.utils.apiError.getError('LOCATION_NO_GEOLOCATION_INFORMATION', {id: this.id}));
    }

    // find people that have addresses linked to this location, that have different coordinates and their GeoLocation is not marked as accurate
    app.models.person
      .rawFind({
        $or: [
          {
            addresses: {
              $elemMatch: {
                locationId: this.id,
                geoLocationAccurate: {
                  $ne: true
                },
                $or: [
                  {
                    'geoLocation.coordinates.0': {
                      $ne: this.geoLocation.lng
                    }
                  },
                  {
                    'geoLocation.coordinates.1': {
                      $ne: this.geoLocation.lat
                    }
                  }
                ]
              }
            }
          },
          {
            'address.locationId': this.id,
            'address.geoLocationAccurate': {
              $ne: true
            },
            $or: [
              {
                'address.geoLocation.coordinates.0': {
                  $ne: this.geoLocation.lng
                }
              },
              {
                'address.geoLocation.coordinates.1': {
                  $ne: this.geoLocation.lat
                }
              }
            ]

          }
        ]
      })
      .then(function (matchedPeople) {
        // keep a list of errors
        const errors = [];
        // build a list of update actions
        const updateActions = [];
        // go through all the people
        matchedPeople.forEach(function (person) {
          // keep a map of fields to update
          const fieldsToUpdate = {};
          // if the person has a list of addresses
          if (Array.isArray(person.addresses)) {
            // go through all of them
            person.addresses.forEach(function (address) {
              // identify those that use current location and the coordinates are marked as inaccurate
              if (address.locationId === self.id && !address.geoLocationAccurate) {
                // update geo-location
                address.geoLocation = {
                  coordinates: [self.geoLocation.lng, self.geoLocation.lat],
                  type: 'Point'
                };
              }
            });
            // update the list of fields to be updated
            fieldsToUpdate['addresses'] = person.addresses;
          }
          // if the person has an address linked to current location and the coordinates are marked as inaccurate
          if (person.address && person.address.locationId === self.id && !person.address.geoLocationAccurate) {
            // update geo-location
            person.address.geoLocation = {
              coordinates: [self.geoLocation.lng, self.geoLocation.lat],
              type: 'Point'
            };
            fieldsToUpdate['address'] = person.address;
          }
          // if there are updates to be made
          if (Object.keys(fieldsToUpdate).length) {
            // add them to the update actions
            updateActions.push(function (callback) {
              // update the person
              app.models.person
                .rawUpdateOne({
                  _id: person.id
                }, fieldsToUpdate, options)
                .then(function (record) {
                  callback(null, record);
                })
                .catch(function (error) {
                  // if there are errors, store them but allow the process to continue
                  errors.push({
                    model: app.models.person.modelName,
                    recordId: person.id,
                    error: error
                  });
                  callback(null, null);
                });
            });
          }
        });

        // update the follow-up resources
        // add an additional update action
        updateActions.push(function (callback) {
          app.models.followUp
            .rawBulkUpdate({
              'address.locationId': self.id,
              'address.geoLocationAccurate': {
                $ne: true
              },
              $or: [
                {
                  'address.geoLocation.coordinates.0': {
                    $ne: self.geoLocation.lng
                  }
                },
                {
                  'address.geoLocation.coordinates.1': {
                    $ne: self.geoLocation.lat
                  }
                }
              ]
            }, {
              'address.geoLocation': {
                coordinates: [self.geoLocation.lng, self.geoLocation.lat],
                type: 'Point'
              }
            }, options)
            .then(function (result) {
              // check if result contains failed resources to add them into errors container
              if (result.notModified) {
                result.notModifiedIDs.forEach(function (id) {
                  errors.push({
                    model: app.models.followUp.modelName,
                    recordId: id
                  });
                });
              }

              // send additional result details
              callback(null, result.modified);
            })
            .catch(function (error) {
              // all followUp updates failed
              errors.push({
                model: app.models.followUp.modelName,
                error: error
              });
              callback(null, null);
            });
        });

        // promisify result
        return new Promise(function (resolve, reject) {
          // run update actions
          async.parallelLimit(updateActions, 10, function (error, results) {
            if (error) {
              return reject(error);
            }
            resolve({
              error: errors,
              success: results.reduce(
                function (accumulator, result) {
                  // don't add null results
                  if (!result) {
                    return;
                  }

                  // followUp resources are updated in bulk so the action result is a number
                  if (!isNaN(result)) {
                    accumulator += result;
                  } else {
                    accumulator++;
                  }
                  return accumulator;
                }, 0)
            });
          });
        });
      })
      .then(function (results) {
        // if errors are present
        if (results.error.length) {
          // some updates succeeded
          if (results.success !== undefined) {
            // send partial error
            callback(app.utils.apiError.getError('BULK_UPDATE_PARTIAL_SUCCESS', {
              model: Location.modelName,
              success: results.success,
              failed: results.error.length,
              errors: results.error
            }));
          } else {
            // all operations failed
            callback(app.utils.apiError.getError('BULK_UPDATE_FAILED', {
              model: Location.modelName,
              failed: results.error.length,
              errors: results.error
            }));
          }
        } else {
          // success
          callback(null, results.success);
        }
      })
      .catch(callback);
  };
};
