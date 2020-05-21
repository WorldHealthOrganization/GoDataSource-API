'use strict';

const app = require('../../server/server');
const templateParser = require('./../../components/templateParser');
const helpers = require('./../../components/helpers');
const _ = require('lodash');
const async = require('async');
const path = require('path');

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
  const modelNames = [];
  // add model name to the list
  if (modelName) {
    modelNames.push(modelName);
  }
  // when importing contact model, relationships are also imported
  if (modelName === app.models.contact.modelName) {
    modelNames.push('relationship');
  }
  return modelNames;
}

/**
 * Get mapping suggestions for model extended form
 * @param outbreakId
 * @param importType ( json, xml, xls... )
 * @param modelName
 * @param headers
 * @param normalizedHeaders
 * @param languageDictionary
 * @param dataset
 * @return {Promise.<T>}
 */
function getMappingSuggestionsForModelExtendedForm(outbreakId, importType, modelName, headers, normalizedHeaders, languageDictionary, dataset, fieldsMap) {
  // make sure we have a valid type
  importType = importType ? importType.toLowerCase() : '.json';

  // start building a result
  const result = {
    suggestedFieldMapping: {},
    modelProperties: {
      [app.models[modelName].extendedForm.containerProperty]: {}
    },
    modelPropertyValues: {},
    modelArrayProperties: {}
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

      // construct variable name
      const getVarName = (variable) => {
        return variable.name;
        /*
        // multi answers need to be basic data arrays which aren't handled by flat file types ( non flat file should work properly without this functionality )
        + (
          !['.json', '.xml'].includes(importType) &&
          app.models[modelName].extendedForm.isBasicArray &&
          app.models[modelName].extendedForm.isBasicArray(variable) ?
            '_____A' :
            ''
        );
         */
      };

      // extract variables from template
      const variables = templateParser.extractVariablesAndAnswerOptions(outbreak[app.models[modelName].extendedForm.template]);

      // if variables are present
      if (variables.length) {
        // normalize them
        const normalizedVariables = variables.map(function (variable) {
          result.modelProperties[app.models[modelName].extendedForm.containerProperty][getVarName(variable)] = variable.text;
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
            result.modelPropertyValues[app.models[modelName].extendedForm.containerProperty][getVarName(variable)] = answers;
          }
        });
      }

      if (['.json', '.xml'].includes(importType)) {
        const multiDateQuestions = outbreak[app.models[modelName].extendedForm.template].filter(q => q.multiAnswer);

        // create a question variable to translation map
        // in order to be able to calculate maximum number of answers for datasets that use translations as field names
        const questionToTranslationMap = [];
        (function addTranslation(questions) {
          return questions
            .forEach(question => {
              question = question.toJSON ? question.toJSON() : question;

              questionToTranslationMap.push({
                variable: question.variable,
                translation: languageDictionary.getTranslation(question.text)
              });

              (question.answers || []).forEach(answer => {
                addTranslation(answer.additionalQuestions || []);
              });
            });
        })(multiDateQuestions);

        // also get extended form container property translation
        // as the JSON file might contain actual translation of the fields and we need to match it against the variable
        const containerProp = app.models[modelName].extendedForm.containerProperty;
        const containerPropTranslation = languageDictionary.getTranslation(fieldsMap[containerProp]);

        const maxAnswersMap = helpers.getQuestionnaireMaxAnswersMap(
          multiDateQuestions,
          importType === '.xml' ? dataset.map(r => {
            let propToChange = containerProp;
            if (!r[containerProp]) {
              if (!r[containerPropTranslation]) {
                return r;
              } else {
                propToChange = containerPropTranslation;
              }
            }

            if (Array.isArray(r[propToChange]) && r[propToChange].length) {
              r[propToChange] = r[propToChange][0];
            }

            return r;
          }) : dataset,
          {containerPropTranslation, questionToTranslationMap}
        );

        for (let variable in maxAnswersMap) {
          result.modelArrayProperties[`${containerProp}.${variable}`] = {
            maxItems: maxAnswersMap[variable]
          };
        }
      }

      return result;
    });
}

/**
 * Calculate maxim number of items an array properties has across multiple records
 * @param records
 */
function getArrayPropertiesMaxLength(records) {
  const result = {};

  // go through each field in each record, build a map of all array properties and nested array properties
  // and their lengths
  for (let record of records) {
    (function traverse(obj, ref) {
      for (let prop in obj) {
        if (obj.hasOwnProperty(prop)) {
          const resultPropRef = `${ref ? ref + '.' : ''}${prop}`;
          if (Array.isArray(obj[prop])) {
            result[resultPropRef] = result[resultPropRef] || [];
            result[resultPropRef].push(obj[prop].length);

            for (let arrProp of obj[prop]) {
              if (typeof arrProp === 'object' && arrProp !== null && !Array.isArray(obj[prop])) {
                traverse(arrProp, `${resultPropRef}[]`);
              }
            }
          }
          if (typeof obj[prop] === 'object' && obj[prop] !== null && !Array.isArray(obj[prop])) {
            traverse(obj[prop], resultPropRef);
          }
        }
      }
    })(record);
  }

  // keep only the highest length in the map
  for (let prop in result) {
    if (result.hasOwnProperty(prop)) {
      let max = 0;
      if (result[prop].length) {
        max = Math.max(...result[prop]);
      }
      result[prop] = {
        maxItems: max
      };
    }
  }
  return result;
}

/**
 * Get a list of distinct values for each property of the dataset
 * @param dataSet
 */
function getDistinctPropertyValues(dataSet) {
  // flatten object
  const flatDataSet = app.utils.helpers.getFlatObject(dataSet);
  // keep a map of distinct values (to ensure unicity)
  let distinctValuesMap = {};
  // go through all the keys
  Object.keys(flatDataSet).forEach(function (property) {
    // sanitize key (remove array markers and leading '.' if present)
    const sanitizedProperty = property
      // don't replace basic types arrays ( string, number, dates etc )
      .replace(/\[\d+]$/g, '')
      // sanitize arrays containing objects object
      .replace(/\[\d+]/g, '[]')
      .replace(/^\[]\.*/, '');
    // if the property was not present in the set
    if (!distinctValuesMap[sanitizedProperty]) {
      // add it
      distinctValuesMap[sanitizedProperty] = {};
    }
    // add the value as a key (to ensure unicity)
    distinctValuesMap[sanitizedProperty][flatDataSet[property]] = true;
  });
  // when done, transform results to arrays
  Object.keys(distinctValuesMap).forEach(function (propName) {
    distinctValuesMap[propName] = Object.keys(distinctValuesMap[propName]);
  });
  return distinctValuesMap;
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

/**
 * Get the list of available locations for for model properties that use locations
 * @param outbreakId
 * @param modelName
 * @returns {PromiseLike<any | never> | Promise<any | never> | *}
 */
function getLocationAvailableValuesForModel(outbreakId, modelName) {
  // get outbreak details
  return app.models.outbreak
    .findById(outbreakId)
    .then(function (outbreak) {
      if (!outbreak) {
        throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.outbreak.modelName, id: outbreakId});
      }
      // get outbreak locations
      let outbreakLocations;
      // update filter only if outbreak has locations ids defined (otherwise leave it as undefined)
      if (Array.isArray(outbreak.locationIds) && outbreak.locationIds.length) {
        // get outbreak location Ids
        outbreakLocations = outbreak.locationIds;
      }
      // promisify the result
      return new Promise(function (resolve, reject) {
        // get the list of locations
        app.models.location.getSubLocationsWithDetails(outbreakLocations, [], {}, function (error, allLocations) {
          // handle eventual errors
          if (error) {
            return reject(error);
          }
          // build a formatted list of locations
          let locationList = [];
          // go through all location entries
          allLocations.forEach(function (location) {
            // format each location entry
            locationList.push({
              id: location.id,
              label: location.name,
              value: location.id
            });
          });
          // make sure locations are sorted
          locationList = locationList.sort(function (a, b) {
            return a.label.localeCompare(b.label);
          });
          const locationValues = {};
          // keep a list of available values for each location related property
          app.models[modelName].locationFields.forEach(function (modelProperty) {
            // split the property in sub components
            const propertyComponents = modelProperty.split('.');
            // if there are sub components
            if (propertyComponents.length > 1) {
              // define parent component
              if (!locationValues[propertyComponents[0]]) {
                locationValues[propertyComponents[0]] = {};
              }
              // store the sub component under parent component
              if (!locationValues[propertyComponents[0]][propertyComponents[1]]) {
                locationValues[propertyComponents[0]][propertyComponents[1]] = locationList;
              }
            } else {
              // no sub components, store property directly
              locationValues[modelProperty] = locationList;
            }
          });
          resolve(locationValues);
        });
      });
    });
}

/**
 * Get available values for foreign keys
 * @param foreignKeysMap Map in format {foreignKey: {modelName: ..., labelProperty: ...}}
 * @returns {Promise<unknown>}
 */
const getForeignKeysValues = function (foreignKeysMap) {
  let foreignKeys = Object.keys(foreignKeysMap);

  // initialize list of functions to be executed async
  let jobs = {};

  // construct jobs
  foreignKeys.forEach(fKey => {
    let foreignKeyInfo = foreignKeysMap[fKey];
    if (!foreignKeyInfo.modelName || !foreignKeyInfo.labelProperty) {
      // cannot get foreign key values as it is not defined correctly
      // should not get here; dev error
      return;
    }

    jobs[fKey] = function (callback) {
      // Note: This query will retrieve all data from the related model
      // depending on data quantity might cause javascript heap out of memory error
      // should be used only for models with limited number of instances
      return app.models[foreignKeyInfo.modelName]
        .rawFind({}, {
          projection: {[foreignKeyInfo.labelProperty]: 1}
        })
        .then(items => {
          return callback(null, items.map(item => {
            return {
              id: item.id,
              label: item[foreignKeyInfo.labelProperty],
              value: item.id
            };
          }));
        })
        .catch(callback);
    };
  });

  return new Promise((resolve, reject) => {
    // execute jobs
    async.series(jobs, function (error, result) {
      // handle errors
      if (error) {
        return reject(error);
      }

      return resolve(result);
    });
  });
};

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
    if (typeof outbreakId === 'function') {
      callback = outbreakId;
      outbreakId = undefined;
    }
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['file'], ImportableFile, [], function (error, fields, files) {
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

      // get user information from request options
      const contextUser = app.utils.remote.getUserFromOptions(options);

      return Promise.resolve()
        .then(() => {
          if (outbreakId) {
            return app.models.outbreak
              .findById(outbreakId)
              .then(outbreak => {
                if (!outbreak) {
                  return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
                    model: app.models.outbreak.modelName,
                    id: outbreakId
                  }));
                }
                return Promise.resolve(outbreak);
              });
          } else {
            return Promise.resolve({});
          }
        })
        .then(outbreak => {
          // load language dictionary for the user
          app.models.language
            .getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
              // handle error
              if (error) {
                return callback(error);
              }

              // get model's extended form
              // doing this in a ultra safe manner, as not all the models have a template
              const modelExtendedForm = app.models[modelName].extendedForm || {};

              // store the file and get its headers
              ImportableFile.storeFileAndGetHeaders(
                file,
                decryptPassword,
                modelName,
                dictionary,
                // questionnaire template
                outbreak[modelExtendedForm.template],
                function (error, result) {
                  // handle errors
                  if (error) {
                    return callback(error);
                  }

                  // get file extension
                  const extension = path.extname(file.name);

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
                      modelPropertyValues: {},
                      modelArrayProperties: {}
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
                              // 3rd nested level (geo-locations)
                              if (propertyComponents.length > 2) {
                                // define parent (sub)component
                                if (!results[modelName].modelProperties[propertyComponents[0]][propertyComponents[1]]) {
                                  results[modelName].modelProperties[propertyComponents[0]][propertyComponents[1]] = {};
                                }
                                // store the sub component under parent (sub)component
                                results[modelName].modelProperties[propertyComponents[0]][propertyComponents[1]][propertyComponents[2]] = fieldLabelsMap[property];
                              } else {
                                // store the sub component under parent component
                                results[modelName].modelProperties[propertyComponents[0]][propertyComponents[1]] = fieldLabelsMap[property];
                              }
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
                              results[modelName] = Object.assign({}, results[modelName], {modelPropertyValues: _.merge(results[modelName].modelPropertyValues, referenceDataValues)});
                              callback(null, results[modelName]);
                            })
                            .catch(callback);
                        });
                      }
                      // if the model uses locations for its properties
                      if (app.models[modelName].locationFields) {
                        // get distinct property values (if not taken already)
                        if (!Object.keys(result.distinctFileColumnValues).length) {
                          result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
                        }
                        steps.push(function (callback) {
                          // get location values
                          getLocationAvailableValuesForModel(outbreakId, modelName)
                            .then(function (locationValues) {
                              // update result
                              results[modelName] = Object.assign({}, results[modelName], {modelPropertyValues: _.merge(results[modelName].modelPropertyValues, locationValues)});
                              callback(null, results[modelName]);
                            })
                            .catch(callback);
                        });
                      }

                      // if the model uses locations for its properties
                      if (app.models[modelName].foreignKeyFields) {
                        // get distinct property values (if not taken already)
                        if (!Object.keys(result.distinctFileColumnValues).length) {
                          result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
                        }
                        steps.push(function (callback) {
                          // get foreign keys values
                          getForeignKeysValues(app.models[modelName].foreignKeyFields)
                            .then(foreignKeysValues => {
                              // update result
                              results[modelName] = Object.assign({}, results[modelName], {modelPropertyValues: _.merge(results[modelName].modelPropertyValues, foreignKeysValues)});
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
                          getMappingSuggestionsForModelExtendedForm(outbreakId, extension, modelName, result.fileHeaders, normalizedHeaders, languageDictionary, dataSet, fieldLabelsMap)
                            .then(function (_result) {
                              // update result
                              results[modelName] = Object.assign(
                                {}, results[modelName],
                                {suggestedFieldMapping: Object.assign(results[modelName].suggestedFieldMapping, _result.suggestedFieldMapping)},
                                {modelProperties: Object.assign(results[modelName].modelProperties, _result.modelProperties)},
                                {modelPropertyValues: Object.assign(results[modelName].modelPropertyValues, _result.modelPropertyValues)},
                                {modelArrayProperties: Object.assign(results[modelName].modelArrayProperties, _result.modelArrayProperties)}
                              );
                              callback(null, results[modelName]);
                            })
                            .catch(callback);
                        });
                      }

                      // get array properties maximum length for non-flat files
                      if (['.json', '.xml'].includes(extension)) {
                        steps.push(callback => {
                          results[modelName].fileArrayHeaders = getArrayPropertiesMaxLength(dataSet);
                          return callback(null, results[modelName]);
                        });
                      }

                      // reference data has categoryId as a 'reference data' type but is not related to other reference data, it is reference data
                      if (modelName === app.models.referenceData.modelName) {
                        steps.push(function (callback) {
                          // get distinct column values (if not taken already) (to map categoyId)
                          if (!Object.keys(result.distinctFileColumnValues).length) {
                            result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
                          }
                          // add categoryId as a reference data item
                          results[modelName] = Object.assign({}, results[modelName], {
                            modelPropertyValues: Object.assign(results[modelName].modelPropertyValues, {
                              categoryId: app.models.referenceData.availableCategories.map(item => Object.assign({label: item.name}, item))
                            })
                          });
                          callback();
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
      } catch (error) {
        // handle JSON.parse errors
        callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
          contentType: 'JSON',
          details: error.message
        }));
      }
    });
  };
};
