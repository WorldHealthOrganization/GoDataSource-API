'use strict';

const app = require('../../server/server');
const formidable = require('formidable');

module.exports = function (ImportableFile) {

  /**
   * Upload a file
   * @param req
   * @param file
   * @param callback
   */
  ImportableFile.upload = function (req, file, callback) {
    // use formidable to parse multi-part data
    const form = new formidable.IncomingForm();
    form.parse(req, function (error, fields, files) {
      // handle errors
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
          model: ImportableFile.modelName,
          properties: missingProperties.join(', ')
        }));
      }
      // store the file and get its headers
      ImportableFile.storeFileAndGetHeaders(files.file, callback)
    });
  };

  /**
   * Get a file (contents) using file id
   * @param id
   * @param callback
   */
  ImportableFile.getJsonById = function (id, callback) {
    // read file
    ImportableFile.getTemporaryFileById(id, function (error, buffer) {
      // handle read errors
      if (error) {
        return callback(error);
      }
      try {
        // send back JSON file
        callback(null, JSON.parse(buffer));
      }
      catch (error) {
        // handle JSON.parse errors
        callback(error);
      }
    });
  };
};
