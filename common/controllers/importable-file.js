'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (ImportableFile) {

  /**
   * Upload a file
   * @param req
   * @param file
   * @param modelName
   * @param [outbreakId]
   * @param callback
   */
  ImportableFile.upload = function (req, file, modelName, outbreakId, callback) {
    // outbreakId is optional
    if (typeof outbreakId === "function") {
      callback = outbreakId;
      outbreakId = undefined;
    }
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['file'], ImportableFile, function (error, fields, files) {
      file = files.file;
      modelName = fields.model;
      // handle errors
      if (error) {
        return callback(error);
      }
      // store the file and get its headers
      ImportableFile.storeFileAndGetHeaders(file, function (error, result) {
        // handle errors
        if (error) {
          return callback(error);
        }
        // keep e reference to parsed content
        const jsonObj = result.jsonObj;
        // remove parsed object from result
        delete result.jsonObj;

        // add additional information to the result
        result.suggestedFieldMapping = {};
        result.availableReferenceDataPropertyValues = {};
        result.distinctColumnValues = {};

        // if a valid model was provided, fill additional data
        if (
          modelName && app.models[modelName] &&
          result.headers.length &&
          app.models[modelName]._importableProperties &&
          app.models[modelName]._importableProperties.length
        ) {
          // in order to provide suggested mappings, normalize (simplify) model property names and headers by stripping
          // out special chars and spaces and converting everything to lowercase
          const normalizedModelProperties = app.models[modelName]._importableProperties.map(function (element) {
            return _.camelCase(element).toLowerCase();
          });
          const normalizedHeaders = result.headers.map(function (element) {
            return _.camelCase(element).toLowerCase();
          });

          // try to find mapping suggestions
          normalizedHeaders.forEach(function (normalizedHeader, index) {
            let propIndex = normalizedModelProperties.indexOf(normalizedHeader);
            if (propIndex !== -1) {
              result.suggestedFieldMapping[result.headers[index]] = app.models[modelName]._importableProperties[propIndex];
            }
          });

          // if the model has fields that use reference data values
          if (app.models[modelName].referenceDataFieldsToCategoryMap) {
            // keep a list of distinct values for each property, to be later used for mapping reference data (if applicable)
            jsonObj.forEach(function (item) {
              Object.keys(item).forEach(function (propName) {
                if (!result.distinctColumnValues[propName]) {
                  result.distinctColumnValues[propName] = {};
                }
                // store the value as property name to ensure uniqueness without performing a search
                result.distinctColumnValues[propName][item[propName]] = true;
              });
            });
            // when done, transform results to arrays
            Object.keys(result.distinctColumnValues).forEach(function (propName) {
              result.distinctColumnValues[propName] = Object.keys(result.distinctColumnValues[propName]);
            });
            // reverse the map
            const categoryToReferenceDataFieldsMap = Object.keys(app.models[modelName].referenceDataFieldsToCategoryMap).reduce(function (reversedMap, key) {
              reversedMap[app.models[modelName].referenceDataFieldsToCategoryMap[key]] = key;
              return reversedMap;
            }, {});
            // keep a list of available values for each reference data related property
            Object.keys(app.models[modelName].referenceDataFieldsToCategoryMap).forEach(function (referenceDataLinkedProperty) {
              result.availableReferenceDataPropertyValues[referenceDataLinkedProperty] = [];
            });
            // find (active) reference data for the referenced categories
            app.models.referenceData
              .find({
                where: {
                  categoryId: {
                    inq: Object.values(app.models[modelName].referenceDataFieldsToCategoryMap)
                  },
                  or: [
                    {
                      outbreakId: {
                        eq: null
                      }
                    },
                    {
                      outbreakId: outbreakId
                    }
                  ],
                  active: true
                },
                order: 'categoryId ASC',
                fields: ['id', 'categoryId', 'value', 'description']
              })
              .then(function (referenceDataItems) {
                // map available values for each property that uses reference data
                referenceDataItems.forEach(function (referenceDataItem) {
                  if (result.availableReferenceDataPropertyValues[categoryToReferenceDataFieldsMap[referenceDataItem.categoryId]]) {
                    result.availableReferenceDataPropertyValues[categoryToReferenceDataFieldsMap[referenceDataItem.categoryId]].push(referenceDataItem);
                  }
                });
                callback(null, result);
              })
              .catch(callback);
          } else {
            callback(null, result);
          }
        } else {
          callback(null, result);
        }
      });
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
        callback(app.utils.apiError.getError("INVALID_CONTENT_OF_TYPE", {
          contentType: 'JSON',
          details: error.message
        }));
      }
    });
  };
};
