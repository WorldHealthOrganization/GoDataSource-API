'use strict';

const helpers = require('./helpers');
const formidable = require('formidable');
const apiError = require('./apiError');
const path = require('path');
const _ = require('lodash');
const Config = require('../server/config.json');

// get max file size for uploaded resource
const maxFileSize = _.get(Config, 'jobSettings.importResources.maxFileSize', 4096);

/**
 * Offer a file to be downloaded
 * @param fileBuffer
 * @param mimeType
 * @param fileName
 * @param remoteCallback
 */
function offerFileToDownload(fileBuffer, mimeType, fileName, remoteCallback) {
  remoteCallback(null, fileBuffer, mimeType, `attachment;filename=${helpers.getAsciiString(path.basename(fileName))}`);
}

/**
 * Parse multipart requests (using formidable) and validate required fields/files
 * @param req
 * @param requiredFields
 * @param requiredFiles
 * @param Model
 * @param optionalFields
 * @param callback
 */
function parseMultipartRequest(req, requiredFields, requiredFiles, Model, optionalFields, callback) {
  // use formidable to parse multi-part data
  const form = new formidable.IncomingForm({
    maxFileSize: maxFileSize * 1024 * 1024
  });
  form.parse(req, function (error, fields, files) {
    // handle errors
    if (error) {
      if (error.message.includes('maxFileSize exceeded')) {
        error = apiError.getError('INVALID_FILE_SIZE');
      }
      return callback(error);
    }
    // validate required properties, loopback can't validate multi-part payloads
    let missingProperties = [];

    // first validate required fields
    requiredFields.forEach(function (field) {
      if (!fields[field] && optionalFields.indexOf(field) === -1) {
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
      return callback(apiError.getError('MISSING_REQUIRED_PROPERTY', {
        model: Model.modelName,
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
