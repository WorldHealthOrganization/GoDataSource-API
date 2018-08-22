'use strict';

const helpers = require('./helpers');
const formidable = require('formidable');
const apiError = require('./apiError');

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
 * @param Model
 * @param callback
 */
function parseMultipartRequest(req, requiredFields, requiredFiles, Model, callback) {
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
      return callback(apiError.getError('MISSING_REQUIRED_PROPERTY', {
        model: Model.modelName,
        properties: missingProperties.join(', ')
      }));
    }
    callback(null, fields, files);
  });
}

/**
 * Export filtered model list
 * @param app Inject app
 * @param Model Model that will be exported
 * @param filter
 * @param exportType
 * @param fileName
 * @param encryptPassword {string|null}
 * @param anonymizeFields
 * @param options
 * @param headersWhitelist {array|null}
 * @param [beforeExport] Optional result modifier before export
 * @param callback
 */
function exportFilteredModelsList(app, Model, filter, exportType, fileName, encryptPassword, anonymizeFields, options, headersWhitelist, beforeExport, callback) {
  // before export is optional
  if (!callback) {
    callback = beforeExport;
    // by default before export is a no-op function that returns a promise
    beforeExport = function (results) {
      return new Promise(function (resolve) {
        resolve(results);
      });
    };
  }
  // find results
  Model.find(filter, function (error, result) {
    // handle errors
    if (error) {
      return callback(error);
    }

    // by default export CSV
    if (!exportType) {
      exportType = 'json';
    } else {
      // be more permissive, always convert to lowercase
      exportType = exportType.toLowerCase();
    }

    // add support for filter parent
    const results = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(result, filter);
    const contextUser = app.utils.remote.getUserFromOptions(options);

    // load user language dictionary
    app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
      // handle errors
      if (error) {
        return callback(error);
      }

      // define a list of table headers
      const headers = [];
      // headers come from model
      Object.keys(Model.fieldLabelsMap).forEach(function (propertyName) {
        // check header restrictions, use property if there are no restrictions or the property is in the restricted (white)list
        if (
          !headersWhitelist ||
          !headersWhitelist.length ||
          headersWhitelist.includes(propertyName)
        ) {
          // if a flat file is exported, data needs to be flattened, include 3 elements for each array
          if (!['json', 'xml'].includes(exportType) && /\[]/.test(propertyName)) {
            let maxElements = 3;
            // pdf has a limited width, include only one element
            if (exportType === 'pdf') {
              maxElements = 1;
            }
            for (let i = 1; i <= maxElements; i++) {
              headers.push({
                id: propertyName.replace('[]', ` ${i}`).replace(/\./g, ' '),
                // use correct label translation for user language
                header: `${dictionary.getTranslation(Model.fieldLabelsMap[propertyName])} [${i}]`
              });
            }
          } else {
            headers.push({
              id: propertyName,
              // use correct label translation for user language
              header: dictionary.getTranslation(Model.fieldLabelsMap[propertyName])
            });
          }
        }
      });

      // resolve model foreign keys (if any)
      helpers.resolveModelForeignKeys(app, Model, results, dictionary)
        .then(function (results) {
          // execute before export hook
          return beforeExport(results, dictionary);
        })
        .then(function (results) {
          // if a there are fields to be anonymized
          if (anonymizeFields.length) {
            // anonymize them
            app.utils.anonymizeDatasetFields.anonymize(results, anonymizeFields);
          }
          return results;
        })
        .then(function (results) {
          // create file with the results
          return app.utils.helpers.exportListFile(headers, results, exportType);
        })
        .then(function (file) {
          if (encryptPassword) {
            return app.utils.aesCrypto.encrypt(encryptPassword, file.data)
              .then(function (data) {
                file.data = data;
                return file;
              });
          } else {
            return file;
          }
        })
        .then(function (file) {
          // and offer it for download
          app.utils.remote.helpers.offerFileToDownload(file.data, file.mimeType, `${fileName}.${file.extension}`, callback);
        })
        .catch(callback);
    });
  });
}

module.exports = {
  offerFileToDownload: offerFileToDownload,
  parseMultipartRequest: parseMultipartRequest,
  exportFilteredModelsList: exportFilteredModelsList
};
