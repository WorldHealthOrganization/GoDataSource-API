'use strict';

const app = require('../../server/server');
const fs = require('fs');
const _ = require('lodash');
const async = require('async');

module.exports = function (Location) {

  /**
   * Export hierarchical locations list
   * @param callback
   */
  Location.exportHierarchicalList = function (callback) {
    Location
      .find({
        // blacklist some fields in the export
        fields: {
          createdAt: false,
          createdBy: false,
          updatedAt: false,
          updatedBy: false,
          deleted: false
        },
        order: ['name ASC', 'parentLocationId ASC', 'id ASC']
      })
      .then(function (locations) {
        app.utils.remote.helpers
          .offerFileToDownload(JSON.stringify(Location.buildHierarchicalLocationsList(locations), null, 2), 'application/json', 'locations.json', callback);
      }).catch(callback);
  };

  /**
   * Get hierarchical locations list
   * @param filter Besides the default filter properties this request also accepts 'includeChildren' boolean on the first level in 'where'; this flag is taken into consideration only if other filters are applied
   * @param callback
   */
  Location.getHierarchicalList = function (filter, callback) {
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

    Location
      .find(app.utils.remote
        .mergeFilters({
          order: ['name ASC', 'parentLocationId ASC', 'id ASC']
        }, filter || {}))
      .then(function (locations) {
        // check for sent filters; if filters were sent we need to return hierarchical list for the found locations
        // this means that we need to also retrieve parent locations and in case where includeChildren is true also retrieve children recursively
        if (filter && filter.where && Object.keys(filter.where).length) {
          // get locations IDs
          let locationsIDs = locations.map(location => location.id);

          // get parent locations
          Location.getParentLocationsWithDetails(locationsIDs, locations, function (error, locationsWithParents) {
            if (error) {
              throw error;
            }

            // check for includeChildren flag
            if (includeChildren) {
              // get sub locations
              Location.getSubLocationsWithDetails(locationsIDs, locationsWithParents, function (error, foundLocations) {
                if (error) {
                  throw error;
                }

                callback(null, Location.buildHierarchicalLocationsList(foundLocations));
              });
            } else {
              callback(null, Location.buildHierarchicalLocationsList(locationsWithParents));
            }
          });
        } else {
          callback(null, Location.buildHierarchicalLocationsList(locations));
        }
      }).catch(callback);
  };

  /**
   * Import a hierarchical list (JSON) of locations
   * @param req
   * @param file This is doc-only, loopback cannot parse multi-part payload.
   * @param options
   * @param callback
   */
  Location.importHierarchicalList = function (req, file, options, callback) {
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['file'], Location, function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // read the file
      fs.readFile(files.file.path, function (error, buffer) {
        if (error) {
          return callback(error);
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
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawLocationsList = JSON.parse(file);
          // remap properties
          const locationsList = app.utils.helpers.convertBooleanProperties(
            Location,
            app.utils.helpers.remapProperties(rawLocationsList, body.map, body.valuesMap));
          // build hierarchical list
          const hierarchicalList = Location.buildHierarchicalLocationsList(locationsList, true);
          // import locations
          Location.importHierarchicalListFromJsonFile(hierarchicalList, options, callback);
        } catch (error) {
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };

  /**
   * Get usage for a location entry
   * @param filter
   * @param callback
   */
  Location.prototype.getUsage = function (filter, callback) {
    Location.findModelUsage(this.id, filter, false)
      .then(function (usage) {
        callback(null, usage);
      })
      .catch(callback);
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
                    recordId: person.id,
                    error: error
                  });
                  callback(null, null);
                });
            });
          }
        });
        // promisify result
        return new Promise(function (resolve, reject) {
          // run update actions
          async.parallelLimit(updateActions, 10, function (error, results) {
            if (error) {
              return reject(error);
            }
            resolve({error: errors, success: results.filter(record => record != null)});
          });
        });
      })
      .then(function (results) {
        // if errors are present
        if (results.error.length) {
          // some updates succeeded
          if (results.success.length) {
            // send partial error
            callback(app.utils.apiError.getError('BULK_UPDATE_PARTIAL_SUCCESS', {
              model: Location.modelName,
              success: results.success.length,
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
          callback(null, results.success.length);
        }
      })
      .catch(callback);
  };
};
