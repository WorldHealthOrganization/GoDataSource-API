'use strict';

const helpers = require('./helpers');
const formidable = require('formidable');

/**
 * Offer a file to be downloaded
 * @param fileBuffer
 * @param mimeType
 * @param fileName
 * @param remoteCallback
 */
function offerFileToDownload(fileBuffer, mimeType, fileName, remoteCallback) {
  remoteCallback(null, fileBuffer, mimeType, `attachment;filename=${helpers.getAsciiString(fileName)}`);
}

/**
 * Parse multipart requests (using formidable) and validate required fields/files
 * @param req
 * @param requiredFields
 * @param requiredFiles
 * @param callback
 */
function parseMultipartRequest(req, requiredFields, requiredFiles, callback) {
  // use formidable to parse multi-part data
  const form = new formidable.IncomingForm();
  form.parse(req, function (error, fields, files) {
    // handle errors
    if (error) {
      return callback(error);
    }
    // validate required properties, loopback can't validate multi-part payloads
    let missingProperties = [];

    // first validate required fields
    requiredFields.forEach(function (field) {
      if (!fields[field]) {
        missingProperties.push(field);
      }
    });

    // then validate files
    requiredFiles.forEach(function (file) {
      if (!files[file]) {
        missingProperties.push(file);
      }
    });

    // if there are missing required properties
    if (missingProperties.length) {
      // send back the error
      return callback(app.utils.apiError.getError('MISSING_REQUIRED_PROPERTY', {
        model: ImportableFile.modelName,
        properties: missingProperties.join(', ')
      }));
    }
    callback(null, fields, files);
  });
}

module.exports = {
  offerFileToDownload: offerFileToDownload,
  parseMultipartRequest: parseMultipartRequest
};
