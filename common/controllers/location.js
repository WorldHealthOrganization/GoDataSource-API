'use strict';

const app = require('../../server/server');
const fs = require('fs');
const _ = require('lodash');

module.exports = function (Location) {

  /**
   * Do not allow the creation of a location with a name/synonyms that is not unique in the same context
   */
  Location.beforeRemote('create', function (context, modelInstance, next) {
    Location.validateModelIdentifiers(context.args.data)
      .then(() => {
        next();
      })
      .catch(next);
  });

  /**
   * Do not allow the update of a location with a name/synonyms that is not unique in the same context.
   * Do not allow the deactivation a location if it still has sub-locations that are active
   */
  Location.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    Location.validateModelIdentifiers(context.args.data, context.instance.id)
      .then(() => {
        if (context.args.data.active === false) {
          return Location.checkIfCanDeactivate(context.args.data, context.instance.id);
        }
      })
      .then(() => {
        next();
      })
      .catch((error) => {
        next(error);
      });
  });

  /**
   * Do not allow the deletion of a location if it still has sub-locations
   */
  Location.beforeRemote('deleteById', function (context, modelInstance, next) {
    Location.checkIfCanDelete(context.args.id)
      .then(() => {
        next();
      })
      .catch(next);
  });

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
        order: 'parentLocationId ASC, id ASC'
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
          order: 'parentLocationId ASC, id ASC'
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
          const locationsList = app.utils.helpers.remapProperties(rawLocationsList, body.map);
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
};
