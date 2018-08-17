'use strict';

const app = require('../../server/server');
const templateParser = require('./../../components/templateParser');
const _ = require('lodash');
const async = require('async');

/**
 * Remove special chars and then lowercase the string
 * @param string
 * @return {string}
 */
function stripSpecialCharsToLowerCase(string) {
  return _.camelCase(string).toLowerCase();
}

/**
 * Get a list of model names associated with passed model name
 * Usually the list consists from the passed model name, but there are some special cases
 * @param modelName
 * @return {*[]}
 */
function getModelNamesFor(modelName) {
  // add model name to the list
  const modelNames = [modelName];
  // when importing contact model, relationships are also imported
  if (modelName === 'contact') {
    modelNames.push('relationship');
  }
  return modelNames;
}

/**
 * Get mapping suggestions for model extended form
 * @param outbreakId
 * @param modelName
 * @param headers
 * @param normalizedHeaders
 * @param languageDictionary
 * @return {Promise.<T>}
 */
function getMappingSuggestionsForModelExtendedForm(outbreakId, modelName, headers, normalizedHeaders, languageDictionary) {
  // start building a result
  const result = {
    suggestedFieldMapping: {},
    modelProperties: {
      [app.models[modelName].extendedForm.containerProperty]: {}
    },
    modelPropertyValues: {}
  };
  // get outbreak
  return app.models.outbreak
    .findById(outbreakId)
    .then(function (outbreak) {
      // if outbreak was not found, stop with error
      if (!outbreak) {
        throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
          model: app.models.outbreak.modelName,
          id: outbreakId
        });
      }
      // extract variables from template
      const variables = templateParser.extractVariablesAndAnswerOptions(outbreak[app.models[modelName].extendedForm.template]);

      // if variables are present
      if (variables.length) {
        // normalize them
        const normalizedVariables = variables.map(function (variable) {
          result.modelProperties[app.models[modelName].extendedForm.containerProperty][variable.name] = variable.text;
          return stripSpecialCharsToLowerCase(languageDictionary.getTranslation(variable.text));
        });
        // try to find mapping suggestions
        normalizedHeaders.forEach(function (normalizedHeader, index) {
          let propIndex = normalizedVariables.indexOf(normalizedHeader);
          if (propIndex !== -1) {
            result.suggestedFieldMapping[headers[index]] = `${app.models[modelName].extendedForm.containerProperty}.${variables[propIndex].name}`;
          }
        });
        // go through the variables
        variables.forEach(function (variable) {
          // if answers were defined for a variable
          if (variable.answers) {
            // store available values list for the extended form
            if (!result.modelPropertyValues[app.models[modelName].extendedForm.containerProperty]) {
              result.modelPropertyValues[app.models[modelName].extendedForm.containerProperty] = {};
            }
            const answers = [];
            // store the answers
            variable.answers.forEach(function (answer) {
              answers.push(Object.assign({id: answer.value}, answer));
            });
            // add them to the available values
            result.modelPropertyValues[app.models[modelName].extendedForm.containerProperty][variable.name] = answers;
          }
        });
      }
      return result;
    });
}

/**
 * Get a list of distinct values for each property of the dataset
 * @param dataSet
 */
function getDistinctPropertyValues(dataSet) {
  const distinctPropertyValues = {};
  // traverse the dataset
  dataSet.forEach(function (item) {
    Object.keys(item).forEach(function (propName) {
      // define container for property values (if not defined)
      if (!distinctPropertyValues[propName]) {
        distinctPropertyValues[propName] = {};
      }
      // store the value as property name to ensure uniqueness without performing a search
      distinctPropertyValues[propName][item[propName]] = true;
    });
  });
  // when done, transform results to arrays
  Object.keys(distinctPropertyValues).forEach(function (propName) {
    distinctPropertyValues[propName] = Object.keys(distinctPropertyValues[propName]);
  });
  return distinctPropertyValues;
}

/**
 * Get a list of available reference data items for each property of the model
 * @param outbreakId
 * @param modelName
 * @return {Promise.<T>}
 */
function getReferenceDataAvailableValuesForModel(outbreakId, modelName) {
  const referenceDataValues = {};
  // find (active) reference data for the referenced categories
  return app.models.outbreak.helpers
    .getSystemAndOwnReferenceData(outbreakId, {
      where: {
        categoryId: {
          inq: Object.values(app.models[modelName].referenceDataFieldsToCategoryMap)
        },
        active: true
      },
      fields: ['id', 'categoryId', 'value', 'description']
    })
    .then(function (referenceDataItems) {
      // create a map of categories to items
      const referenceDataItemsByCategory = {};
      referenceDataItems.forEach(function (referenceDataItem) {
        if (!referenceDataItemsByCategory[referenceDataItem.categoryId]) {
          referenceDataItemsByCategory[referenceDataItem.categoryId] = [];
        }
        referenceDataItemsByCategory[referenceDataItem.categoryId].push({
          id: referenceDataItem.id,
          label: referenceDataItem.value,
          value: referenceDataItem.value
        });
      });

      // keep a list of available values for each reference data related property
      Object.keys(app.models[modelName].referenceDataFieldsToCategoryMap).forEach(function (modelProperty) {
        // split the property in sub components
        const propertyComponents = modelProperty.split('.');
        // if there are sub components
        if (propertyComponents.length > 1) {
          // define parent component
          if (!referenceDataValues[propertyComponents[0]]) {
            referenceDataValues[propertyComponents[0]] = {};
          }
          // store the sub component under parent component
          if (!referenceDataValues[propertyComponents[0]][propertyComponents[1]]) {
            referenceDataValues[propertyComponents[0]][propertyComponents[1]] = referenceDataItemsByCategory[app.models[modelName].referenceDataFieldsToCategoryMap[modelProperty]] || [];
          }
        } else {
          // no sub components, store property directly
          referenceDataValues[modelProperty] = referenceDataItemsByCategory[app.models[modelName].referenceDataFieldsToCategoryMap[modelProperty]] || [];
        }
      });
      return referenceDataValues;
    });
}

module.exports = function (ImportableFile) {

  /**
   * Upload a file
   * @param req
   * @param file
   * @param modelName
   * @param decryptPassword
   * @param options
   * @param [outbreakId]
   * @param callback
   */
  ImportableFile.upload = function (req, file, modelName, decryptPassword, options, outbreakId, callback) {
    // outbreakId is optional
    if (typeof outbreakId === "function") {
      callback = outbreakId;
      outbreakId = undefined;
    }
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['file'], ImportableFile, function (error, fields, files) {
      file = files.file;
      modelName = fields.model;
      decryptPassword = null;

      // if the decrypt password is valid, use it
      if (typeof fields.decryptPassword === 'string' && fields.decryptPassword.length) {
        decryptPassword = fields.decryptPassword;
      }

      // handle errors
      if (error) {
        return callback(error);
      }
      // store the file and get its headers
      ImportableFile.storeFileAndGetHeaders(file, decryptPassword, function (error, result) {
        // handle errors
        if (error) {
          return callback(error);
        }

        // keep e reference to parsed content
        const dataSet = result.jsonObj;
        // define main result
        result = {
          id: result.id,
          fileHeaders: result.headers,
          distinctFileColumnValues: {}
        };
        // store results for multiple models
        const results = {};
        // define language dictionary, it will be updated (conditionally) later
        let languageDictionary = {};
        // define normalized headers, they will be updated (conditionally) later
        let normalizedHeaders = {};
        // store a list of steps that will be executed
        const steps = [];
        // store main model name
        const mainModelName = modelName;

        // go through the list of models associated with the passed model name
        getModelNamesFor(modelName).forEach(function (modelName) {

          // each model has its own results
          results[modelName] = {
            modelProperties: {},
            suggestedFieldMapping: {},
            modelPropertyValues: {}
          };

          // if a valid model was provided, and file headers were found
          if (modelName && app.models[modelName] && result.fileHeaders.length) {

            // normalize the headers if they were not previously normalized
            if (!Object.keys(normalizedHeaders).length) {
              // normalize file headers
              normalizedHeaders = result.fileHeaders.map(function (header) {
                return stripSpecialCharsToLowerCase(header);
              });
            }

            // if the model has importable properties or the model uses extended form, load up language dictionary (if it was not previously loaded)
            // it will be used for mapping suggestions
            if (
              languageDictionary.getTranslation === undefined &&
              (
                app.models[modelName]._importableProperties && app.models[modelName]._importableProperties.length ||
                outbreakId !== undefined && app.models[modelName].extendedForm && app.models[modelName].extendedForm.template
              )
            ) {
              steps.push(function (callback) {
                // get user information from request options
                const contextUser = app.utils.remote.getUserFromOptions(options);
                // load language dictionary for the user
                app.models.language
                  .getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
                    // handle error
                    if (error) {
                      return callback(error);
                    }
                    languageDictionary = dictionary;
                    callback(null, dictionary);
                  });
              });
            }

            // get model's field labels map
            const fieldLabelsMap = app.models[modelName].fieldLabelsMap || {};
            // if the model has importable properties, get their headers and try to suggest some mappings
            if (app.models[modelName]._importableProperties && app.models[modelName]._importableProperties.length) {
              steps.push(function (callback) {
                // normalize model headers (property labels)
                const normalizedModelProperties = app.models[modelName]._importableProperties.map(function (property) {
                  // split the property in sub components
                  const propertyComponents = property.split('.');
                  // if there are sub components
                  if (propertyComponents.length > 1) {
                    // define parent component
                    if (!results[modelName].modelProperties[propertyComponents[0]]) {
                      results[modelName].modelProperties[propertyComponents[0]] = {};
                    }
                    // store the sub component under parent component
                    results[modelName].modelProperties[propertyComponents[0]][propertyComponents[1]] = fieldLabelsMap[property];
                  } else {
                    // no sub components, store property directly
                    results[modelName].modelProperties[property] = fieldLabelsMap[property];
                  }
                  return stripSpecialCharsToLowerCase(languageDictionary.getTranslation(fieldLabelsMap[property]));
                });

                // try to find mapping suggestions between file headers and model headers (property labels)
                normalizedHeaders.forEach(function (normalizedHeader, index) {
                  let propIndex = normalizedModelProperties.indexOf(normalizedHeader);
                  if (propIndex !== -1) {
                    results[modelName].suggestedFieldMapping[result.fileHeaders[index]] = app.models[modelName]._importableProperties[propIndex];
                  }
                });
                callback(null, results[modelName]);
              });
            }

            // if the model uses reference data for its properties
            if (app.models[modelName].referenceDataFieldsToCategoryMap) {
              // get distinct property values
              result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
              steps.push(function (callback) {
                // get reference data
                getReferenceDataAvailableValuesForModel(outbreakId, modelName)
                  .then(function (referenceDataValues) {
                    // update result
                    results[modelName] = Object.assign({}, results[modelName], {modelPropertyValues: Object.assign(results[modelName].modelPropertyValues, referenceDataValues)});
                    callback(null, results[modelName]);
                  })
                  .catch(callback);
              });
            }

            // if outbreakId was sent (templates are stored at outbreak level) and the model uses extended form template
            if (outbreakId !== undefined && app.models[modelName].extendedForm && app.models[modelName].extendedForm.template) {
              // get distinct property values (if not taken already)
              if (!Object.keys(result.distinctFileColumnValues).length) {
                result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
              }
              // get mapping suggestions for extended form
              steps.push(function (callback) {
                getMappingSuggestionsForModelExtendedForm(outbreakId, modelName, result.fileHeaders, normalizedHeaders, languageDictionary)
                  .then(function (_result) {
                    // update result
                    results[modelName] = Object.assign(
                      {}, results[modelName],
                      {suggestedFieldMapping: Object.assign(results[modelName].suggestedFieldMapping, _result.suggestedFieldMapping)},
                      {modelProperties: Object.assign(results[modelName].modelProperties, _result.modelProperties)},
                      {modelPropertyValues: Object.assign(results[modelName].modelPropertyValues, _result.modelPropertyValues)}
                    );
                    callback(null, results[modelName]);
                  })
                  .catch(callback);
              });
            }
          }
        });

        // execute the list of steps
        async.series(steps, function (error) {
          // handle errors
          if (error) {
            return callback(error);
          }

          // when everything is done, merge the results
          Object.keys(results).forEach(function (modelName) {
            // if the model in not the main one, store its results in a container with its name
            if (modelName !== mainModelName) {

              // rebuild suggestions for result
              const suggestedFieldMapping = {};
              // prefix all suggestions with model (container) name
              Object.keys(results[modelName].suggestedFieldMapping).forEach(function (fileHeader) {
                suggestedFieldMapping[fileHeader] = `${modelName}.${results[modelName].suggestedFieldMapping[fileHeader]}`;
              });

              // update result
              result = Object.assign(
                {},
                result,
                // main model takes precedence on mapping
                {suggestedFieldMapping: Object.assign(suggestedFieldMapping, result.suggestedFieldMapping)},
                {modelProperties: Object.assign(result.modelProperties, {[modelName]: results[modelName].modelProperties})},
                {modelPropertyValues: Object.assign(result.modelPropertyValues, {[modelName]: results[modelName].modelPropertyValues})}
              );
            } else {
              // main model results stay on first level
              result = Object.assign({}, result, results[modelName]);
            }
          });

          // send back the result
          callback(null, result);
        });
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
