'use strict';

const app = require('../../server/server');
const formidable = require('formidable');
const fs = require('fs');

module.exports = function (Location) {

  /**
   * Do not allow the creation of a location with a name/synonyms that is not unique in the same context
   */
  Location.beforeRemote("create", function (context, modelInstance, next) {
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
  Location.beforeRemote("prototype.patchAttributes", function (context, modelInstance, next) {
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
  Location.beforeRemote("deleteById", function (context, modelInstance, next) {
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
          .offerFileToDownload(JSON.stringify(Location.buildHierarchicalLocationsList(locations), null, 2), 'application/json', `locations.json`, callback);
      }).catch(callback);
  };

  /**
   * Get hierarchical locations list
   * @param callback
   */
  Location.getHierarchicalList = function (callback) {
    Location
      .find({
        order: 'parentLocationId ASC, id ASC'
      })
      .then(function (locations) {
        callback(null, Location.buildHierarchicalLocationsList(locations));
      }).catch(callback);
  };

  /**
   * Import a hierarchical list (JSON) of locations
   * @param req
   * @param file
   * @param options
   * @param callback
   */
  Location.importHierarchicalList = function (req, file, options, callback) {
    // use formidable to parse multi-part data
    const form = new formidable.IncomingForm();
    form.parse(req, function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // validate required properties, loopback can't validate multi-part payloads
      let missingProperties = [];

      if (!files.file) {
        missingProperties.push('file');
      }
      // if there are missing required properties
      if (missingProperties.length) {
        // send back the error
        return callback(app.utils.apiError.getError('MISSING_REQUIRED_PROPERTY', {
          model: Location.modelName,
          properties: missingProperties.join(', ')
        }));
      }
      // read the file
      fs.readFile(files.file.path, function (error, buffer) {
        if (error) {
          return callback(error);
        }
        // import locations
        Location.importHierarchicalListFromJsonFile(buffer, options, callback);
      });
    });
  };

  Location.importImportableFileUsingMap = function (body, options, callback) {
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        if (error) {
          return callback(error);
        }
        try {
          let _list = JSON.parse(file);
          _list = app.utils.helpers.remapProperties(_list, body.map);
          let _hl = Location.buildHierarchicalLocationsList(_list, true);
          // import locations
          Location.importHierarchicalListFromJsonFile(_hl, options, callback);
        } catch (error) {
          callback(error);
        }
      })
  }
};
