'use strict';

const helpers = require('./helpers');
const formidable = require('formidable');
const apiError = require('./apiError');
const path = require('path');
const _ = require('lodash');

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
 * @param modelPropertiesExpandOnFlatFiles Headers for custom fields like questionnaireAnswers
 * @param query
 * @param exportType
 * @param fileName
 * @param encryptPassword {string|null}
 * @param anonymizeFields
 * @param options
 * @param [beforeExport] Optional result modifier before export
 * @param callback
 */
function exportFilteredModelsList(
  app,
  Model,
  modelPropertiesExpandOnFlatFiles,
  query,
  exportType,
  fileName,
  encryptPassword,
  anonymizeFields,
  options,
  beforeExport,
  callback
) {
  // no-op fallback function for beforeExport hook
  // used for defensive checks, when it is not passed
  let noOp = (results) => Promise.resolve(results);
  beforeExport = beforeExport || noOp;

  // before export is optional
  if (!callback) {
    callback = beforeExport;
    // by default before export is a no-op function that returns a promise
    beforeExport = noOp;
  }

  let modelPropertiesExpandOnFlatFilesKeys = [];

  // find results
  Model.rawFind(query)
    .then(function (results) {

      // convert geo-points (if any)
      results.forEach(function (result) {
        helpers.covertAddressesGeoPointToLoopbackFormat(result);
      });

      if (!modelPropertiesExpandOnFlatFiles.questionnaireAnswers && options.questionnaire) {
        modelPropertiesExpandOnFlatFiles.questionnaireAnswers = helpers.retrieveQuestionnaireVariables(
          options.questionnaire,
          'questionnaireAnswers',
          options.dictionary,
          options.useQuestionVariable,
          helpers.getQuestionnaireMaxAnswersMap(options.questionnaire, results)
        );
      }

      // retrieve keys for expandable properties
      modelPropertiesExpandOnFlatFilesKeys = modelPropertiesExpandOnFlatFiles ?
        Object.keys(modelPropertiesExpandOnFlatFiles) : [];

      // by default export CSV
      if (!exportType) {
        exportType = 'json';
      } else {
        // be more permissive, always convert to lowercase
        exportType = exportType.toLowerCase();
      }

      const contextUser = app.utils.remote.getUserFromOptions(options);

      // load user language dictionary
      app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
        // handle errors
        if (error) {
          return callback(error);
        }

        helpers.attachParentLocations(
          Model,
          app.models.location,
          results,
          (err, result) => {
            let highestParentsChain = 0;
            if (!err) {
              result = result || {};
              results = result.records || results;
              highestParentsChain = result.highestParentsChain || 0;
            }

            // define a list of table headers
            const headers = [];
            // headers come from model
            const fieldLabelsMap = Model.helpers && Model.helpers.sanitizeFieldLabelsMapForExport ? Model.helpers.sanitizeFieldLabelsMapForExport() : Model.fieldLabelsMap;

            const isJSONXMLExport = ['json', 'xml'].includes(exportType);
            const ignoreArrayFieldLabels = Model.hasOwnProperty('arrayProps');

            // some models may have a specific order for headers
            let originalFieldsList = Object.keys(fieldLabelsMap);
            let fieldsList = [];
            if (Model.exportFieldsOrder) {
              fieldsList = [...Model.exportFieldsOrder];
              // sometimes the order list contains only a subset of the actual fields list
              if (Model.exportFieldsOrder.length !== originalFieldsList.length) {
                fieldsList.push(...originalFieldsList.filter(f => Model.exportFieldsOrder.indexOf(f) === -1));
              }
            } else {
              fieldsList = [...originalFieldsList];
            }

            fieldsList.forEach(function (propertyName) {
              // new functionality, not supported by all models
              if (!isJSONXMLExport && ignoreArrayFieldLabels && Model.arrayProps[propertyName]) {
                // determine if we need to include parent token
                const parentToken = fieldLabelsMap[propertyName];

                // array properties map
                const map = Model.arrayProps[propertyName];

                // create headers
                let maxElements = 3;
                // pdf has a limited width, include only one element
                if (exportType === 'pdf') {
                  maxElements = 1;
                }
                for (let i = 1; i <= maxElements; i++) {
                  for (let prop in map) {
                    headers.push({
                      id: `${propertyName} ${i} ${prop.replace(/\./g, ' ')}`,
                      // use correct label translation for user language
                      header: `${parentToken ? dictionary.getTranslation(parentToken) + ' ' : ''}${dictionary.getTranslation(map[prop])} [${i}]`
                    });
                    // include parent locations
                    if (
                      Model.locationFields &&
                      Model.locationFields.indexOf(`${propertyName}[].${prop}`) !== -1
                    ) {
                      for (let j = 1; j <= highestParentsChain; j++) {
                        headers.push({
                          id: `${propertyName} ${i} ${prop}_parentLocations ${j}`,
                          // use correct label translation for user language
                          header: `${parentToken ? dictionary.getTranslation(parentToken) + ' ' : ''}${dictionary.getTranslation(map[prop])} [${i}] ${dictionary.getTranslation('LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL')} [${j}]`
                        });
                      }
                    }
                  }
                }
                return;
              }

              // do not handle array properties from field labels map when we have arrayProps set on the model
              if (!isJSONXMLExport && propertyName.indexOf('[]') > -1 && ignoreArrayFieldLabels) {
                return;
              }

              // if a flat file is exported, data needs to be flattened, include 3 elements for each array
              if (!isJSONXMLExport && propertyName.indexOf('[]') > -1) {
                // determine if we need to include parent token
                let parentToken;
                const parentIndex = propertyName.indexOf('.');
                if (parentIndex >= -1) {
                  const parentKey = propertyName.substr(0, parentIndex);
                  parentToken = fieldLabelsMap[parentKey];
                }


                // create headers
                let maxElements = 3;
                // pdf has a limited width, include only one element
                if (exportType === 'pdf') {
                  maxElements = 1;
                }
                for (let i = 1; i <= maxElements; i++) {
                  headers.push({
                    id: propertyName.replace('[]', ` ${i}`).replace(/\./g, ' '),
                    // use correct label translation for user language
                    header: `${parentToken ? dictionary.getTranslation(parentToken) + ' ' : ''}${dictionary.getTranslation(fieldLabelsMap[propertyName])}${/\[]/.test(propertyName) ? ' [' + i + ']' : ''}`
                  });
                }
              } else {
                if (
                  !isJSONXMLExport &&
                  modelPropertiesExpandOnFlatFiles &&
                  modelPropertiesExpandOnFlatFiles[propertyName]
                ) {
                  headers.push(...modelPropertiesExpandOnFlatFiles[propertyName]);
                } else {
                  let headerTranslation = dictionary.getTranslation(fieldLabelsMap[propertyName]);

                  if (!isJSONXMLExport) {
                    // determine if we need to include parent token
                    let parentToken;
                    const parentIndex = propertyName.indexOf('.');
                    if (parentIndex >= -1) {
                      const parentKey = propertyName.substr(0, parentIndex);
                      parentToken = fieldLabelsMap[parentKey];
                    }
                    if (parentToken) {
                      headerTranslation = dictionary.getTranslation(parentToken) + ' ' + headerTranslation;
                    }
                  }

                  headers.push({
                    id: !isJSONXMLExport ? propertyName.replace(/\./g, ' ') : propertyName,
                    // use correct label translation for user language
                    header: headerTranslation
                  });

                  // check if we need to include parent locations column
                  if (
                    Model.locationFields &&
                    Model.locationFields.indexOf(propertyName) !== -1
                  ) {
                    if (isJSONXMLExport) {
                      headers.push({
                        id: `${propertyName}_parentLocations`,
                        header: `${headerTranslation} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION')}`
                      });
                    } else {
                      for (let i = 1; i <= highestParentsChain; i++) {
                        headers.push({
                          id: `${propertyName}_parentLocations ${i}`,
                          header: `${headerTranslation} ${dictionary.getTranslation('LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL')} [${i}]`
                        });
                      }
                    }
                  }
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
                // expand sub items for non-flat files
                if (isJSONXMLExport) {
                  modelPropertiesExpandOnFlatFilesKeys.forEach((propertyName) => {
                    // map properties to labels
                    const propertyMap = {};
                    (modelPropertiesExpandOnFlatFiles[propertyName] || []).forEach((headerData) => {
                      propertyMap[headerData.expandKey ? headerData.expandKey : headerData.id] = headerData.expandHeader ? headerData.expandHeader : headerData.header;
                    });

                    // convert record data
                    (results || []).forEach((record) => {
                      // for now we handle only object expanses ( e.g. questionnaireAnswers ) and not array of objects
                      if (
                        record[propertyName] &&
                        _.isObject(record[propertyName]) &&
                        !_.isEmpty(record[propertyName])
                      ) {
                        // construct the new object
                        const newValue = {};
                        Object.keys(record[propertyName]).forEach((childPropName) => {
                          if (propertyMap[childPropName] !== undefined) {
                            newValue[propertyMap[childPropName]] = record[propertyName][childPropName];
                          } else {
                            newValue[childPropName] = record[propertyName][childPropName];
                          }
                        });

                        // replace the old object
                        record[propertyName] = newValue;
                      }
                    });
                  });
                }

                // finished
                return results;
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
          }
        );
      });
    })
    .catch(callback);
}

module.exports = {
  offerFileToDownload: offerFileToDownload,
  parseMultipartRequest: parseMultipartRequest,
  exportFilteredModelsList: exportFilteredModelsList
};
