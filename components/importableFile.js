'use strict';

const _ = require('lodash');
const async = require('async');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const os = require('os');
const xlsx = require('xlsx');
const sort = require('alphanum-sort');
const apiError = require('./apiError');
const helpers = require('./helpers');
const aesCrypto = require('./aesCrypto');
const baseLanguageModel = require('./baseModelOptions/language');
const baseReferenceDataModel = require('./baseModelOptions/referenceData');
const convertLoopbackFilterToMongo = require('./convertLoopbackFilterToMongo');
const MongoDBHelper = require('./mongoDBHelper');
const WorkerRunner = require('./workerRunner');

// define a list of supported file extensions
const supportedFileExtensions = [
  '.json',
  '.csv',
  '.xls',
  '.xlsx',
  '.ods'
];

/**
 * Remove special chars and then lowercase the string
 * @param string
 * @return {string}
 */
const stripSpecialCharsToLowerCase = function (string) {
  return _.camelCase(string).toLowerCase();
};

/**
 * Validate file extension
 * @param extension
 * @return {boolean}
 */
const isExtensionSupported = function (extension) {
  return supportedFileExtensions.indexOf(extension) !== -1;
};

/**
 * Get JSON file using file id
 * @param {string} fileId - File ID
 * @returns {Promise<unknown>}
 */
const getTemporaryFileById = function (fileId) {
  return new Promise((resolve, reject) => {
    // prevent path traversal vulnerability
    if (
      !fileId ||
      fileId.indexOf('\\') !== -1 ||
      fileId.indexOf('/') !== -1
    ) {
      return reject(apiError.getError('FILE_NOT_FOUND', {
        contentType: 'JSON',
        details: 'File not found'
      }));
    }

    fs.readFile(path.join(os.tmpdir(), fileId), (err, data) => {
      if (err) {
        return reject(apiError.getError('FILE_NOT_FOUND', {
          contentType: 'JSON',
          details: 'File not found'
        }));
      }

      try {
        // send back JSON file
        resolve(JSON.parse(data));
      } catch (error) {
        // handle JSON.parse errors
        reject(apiError.getError('INVALID_CONTENT_OF_TYPE', {
          contentType: 'JSON',
          details: 'Invalid JSON content: Invalid file'
        }));
      }
    });
  });
};

/**
 * Get JSON content and headers
 * @param data
 * @param callback
 */
const getJsonHeaders = function ({data}, callback) {
  // try and parse as a JSON
  try {
    const jsonObj = JSON.parse(data);
    // this needs to be a list (in order to get its headers)
    if (!Array.isArray(jsonObj)) {
      // error invalid content
      return callback(apiError.getError('INVALID_CONTENT_OF_TYPE', {
        contentType: 'JSON',
        details: 'it should contain an array'
      }));
    }
    // build a list of headers
    const headers = [];
    // store list of properties for each header
    const headersToPropsMap = {};
    // build the list by looking at the properties of all elements (not all items have all properties)
    jsonObj.forEach(function (item) {
      // go through all properties of flatten item
      const flatItem = helpers.getFlatObject(item);
      Object.keys(flatItem).forEach(function (property) {
        const sanitizedProperty = property
          // don't replace basic types arrays ( string, number, dates etc )
          .replace(/\[\d+]$/g, '')
          // sanitize arrays containing objects object
          .replace(/\[\d+]/g, '[]')
          .replace(/^\[]\.*/, '');
        // add the header if not already included
        if (!headersToPropsMap[sanitizedProperty]) {
          headers.push(sanitizedProperty);
          headersToPropsMap[sanitizedProperty] = new Set();
        }

        // add prop to headers map if simple property; null values are skipped
        // children of object properties will be added separately
        if (typeof flatItem[property] !== 'object') {
          headersToPropsMap[sanitizedProperty].add(property);
        }
      });
    });

    // send back the parsed object and its headers
    callback(null, {obj: jsonObj, headers: headers, headersToPropsMap: headersToPropsMap});
  } catch (error) {
    // handle JSON.parse errors
    callback(apiError.getError('INVALID_CONTENT_OF_TYPE', {
      contentType: 'JSON',
      details: error.message
    }));
  }
};

/**
 * Get XLS/XLSX/CSV/ODS fileContent as JSON and its headers
 * @param data
 * @param callback
 */
const getSpreadSheetHeaders = function ({data, extension}, callback) {
  // parse XLS data
  const parseOptions = {
    cellText: false
  };
  // for CSV do not parse the fields
  // because it breaks number values like 0000008 -> 8
  // or date values losing timestamp information
  // this is needed because parser tries to format all the fields to date, no matter the value
  if (extension === '.csv') {
    parseOptions.raw = true;
  } else {
    parseOptions.cellDates = true;
  }
  const parsedData = xlsx.read(data, parseOptions);
  // extract first sheet name (we only care about first sheet)
  let sheetName = parsedData.SheetNames.shift();
  // convert data to JSON
  let jsonObj = xlsx.utils.sheet_to_json(parsedData.Sheets[sheetName], {
    dateNF: 'YYYY-MM-DD'
  });
  // get columns by walking through the keys and using only the first row
  const columns = sort(Object.keys(parsedData.Sheets[sheetName]).filter(function (item) {
    // ignore ref property
    if (item === '!ref') {
      return false;
    }
    // get data index
    const matches = item.match(/(\d+)/);
    if (matches && matches[1]) {
      // get only first row
      return parseInt(matches[1]) === 1;
    }
    return false;
  }));
  // keep a list of headers
  let headers = [];
  // keep a list of how many times a header appears
  let sameHeaderCounter = {};
  // if columns found
  if (columns.length) {
    // go through all columns
    columns.forEach(function (columnId) {
      let headerValue = parsedData.Sheets[sheetName][`${columnId}`].v;
      // if this is the first time the header appears
      if (sameHeaderCounter[headerValue] === undefined) {
        // create an entry for it in the counter
        sameHeaderCounter[headerValue] = 0;
      } else {
        // increment counter
        sameHeaderCounter[headerValue]++;
        // update header value to match those built by xlsx.utils.sheet_to_json
        headerValue = `${headerValue}_${sameHeaderCounter[headerValue]}`;
      }
      headers.push(headerValue);
    });
  }
  // should always be an array (sheets are lists)
  // send back the parsed object and its headers
  callback(null, {obj: jsonObj, headers: headers});
};

/**
 * Store file on disk
 * @param content
 * @param callback
 */
const temporaryStoreFileOnDisk = function (content, callback) {
  // create a unique file name
  const fileId = uuid.v4();
  // store file in temporary folder
  fs.writeFile(path.join(os.tmpdir(), fileId), content, function (error) {
    callback(error, fileId);
  });
};

/**
 * Store file and get its headers and file Id
 * @param file
 * @param decryptPassword
 * @param modelOptions
 * @param dictionary
 * @param questionnaire
 * @returns {Promise<never>|Promise<unknown>}
 */
const storeFileAndGetHeaders = function (file, decryptPassword, modelOptions, dictionary, questionnaire) {
  // get file extension
  const extension = path.extname(file.name).toLowerCase();
  // if extension is invalid
  if (!isExtensionSupported(extension)) {
    // send back the error
    return Promise.reject(apiError.getError('UNSUPPORTED_FILE_TYPE', {
      fileName: file.name,
      details: `unsupported extension ${extension}. Supported file extensions: ${supportedFileExtensions.join(', ')}`
    }));
  }

  // use appropriate content handler for file type
  let getHeaders;
  let headersFormat;
  switch (extension) {
    case '.json':
      getHeaders = getJsonHeaders;
      headersFormat = 'json';
      break;
    case '.csv':
    case '.xls':
    case '.xlsx':
    case '.ods':
      getHeaders = getSpreadSheetHeaders;
      headersFormat = 'xlsx';
      break;
  }

  return new Promise((resolve, reject) => {
    fs.readFile(file.path, function (error, buffer) {
      // handle error
      if (error) {
        return reject(apiError.getError('FILE_NOT_FOUND'));
      }

      // decrypt file if needed
      let decryptFile;
      if (decryptPassword) {
        decryptFile = aesCrypto.decrypt(decryptPassword, buffer);
      } else {
        decryptFile = Promise.resolve(buffer);
      }

      decryptFile
        .then(function (buffer) {
          // get file headers
          getHeaders({data: buffer, modelOptions, dictionary, questionnaire, extension}, function (error, result) {
            // handle error
            if (error) {
              return reject(error);
            }

            // construct file contents
            const contents = {
              data: result.obj,
              headersFormat: headersFormat
            };

            // add headers to prop map in file
            if (result.headersToPropsMap) {
              contents.headersToPropMap = {};
              result.headers.forEach(header => {
                contents.headersToPropMap[header] = [...result.headersToPropsMap[header]];
              });
            }

            // store file on disk
            temporaryStoreFileOnDisk(JSON.stringify(contents), function (error, fileId) {
              // handle error
              if (error) {
                return reject(error);
              }

              // send back file id and headers
              resolve({
                id: fileId,
                headers: result.headers,
                jsonObj: result.obj
              });
            });
          });
        })
        .catch(reject);
    });
  });
};

/**
 * Get a list of distinct values for the given properties of the dataset
 * @param {Object} fileContents - Imported file contents as saved by the storeFileAndGetHeaders function
 * {
 * data: [{
 *   "simple prop on first level or nested": ...
 *   "simple prop in an array of objects [1]": ...
 *   "Addresses Location [1] Location Geographical Level [1]"
 * }]
 * headersFormat: 'json/xlsx',
 * headersToPropMap: {
 *   'header': ['prop1', 'prop2']
 * }
 * }
 * @param {Array} properties - List of properties for which to return the distinct values
 * @returns {{}}
 */
const getDistinctPropertyValues = function (fileContents, properties) {
  // initialize result
  const result = {};

  if (!properties || !properties.length || !fileContents || !fileContents.data || !fileContents.data.length) {
    return result;
  }

  const dataset = fileContents.data;

  // initialize a set for each needed property
  properties.forEach(prop => {
    result[prop] = new Set();
  });

  // check for the format of the headers in file
  switch (fileContents.headersFormat) {
    case 'json': {
      // for JSON the properties for each header were stored when the file was imported
      const headersToPropMap = fileContents.headersToPropMap;
      // get each requested property values from the dataset
      dataset.forEach(entry => {
        properties.forEach(prop => {
          if (!headersToPropMap[prop]) {
            // requested prop is not valid
            return;
          }

          // get the values from all paths for the prop
          headersToPropMap[prop].forEach(pathToValue => {
            const value = _.get(entry, pathToValue);
            // stringify value and add it in set
            (value !== undefined) && result[prop].add(value + '');
          });
        });
      });

      break;
    }
    case 'xlsx': {
      // get each requested property values from the dataset
      dataset.forEach(entry => {
        Object.keys(entry).forEach(prop => {
          // check if the requested prop is an actual entry prop
          if (result[prop]) {
            result[prop].add(entry[prop]);
            return;
          }

          // sanitize key (remove array markers)
          const sanitizedProperty = prop
            // don't replace basic types arrays ( string, number, dates etc )
            .replace(/\[\d+]$/g, '')
            // sanitize arrays containing objects
            .replace(/\[\d+]/g, '[]');

          if (result[sanitizedProperty]) {
            result[sanitizedProperty].add(entry[prop]);
            return;
          }

          // at this point we have handled flat files
          // requested prop is not valid
        });
      });
      break;
    }
    default:
      break;
  }

  // when done, transform results to arrays
  Object.keys(result).forEach(prop => {
    if (!result[prop].size) {
      // add single "null" value to be consistent with old functionality
      result[prop] = [null + ''];
    } else {
      result[prop] = [...result[prop]];
    }
  });
  return result;
};

/**
 * Get available values for foreign keys
 * @param foreignKeysMap Map in format {foreignKey: {modelName: ..., labelProperty: ..., filter: ...}}
 * @param outbreak Outbreak instance; there might be cases where it is not present
 * @returns {Promise<unknown>}
 */
const getForeignKeysValues = function (foreignKeysMap, outbreak) {
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

    // check if a filter needs to be applied for the foreign key
    // Note: Currently we are only supporting filtering by outbreak properties and only checking first level properties
    let foreignKeyQuery = {};
    if (foreignKeyInfo.filter) {
      foreignKeyQuery = _.cloneDeep(foreignKeyInfo.filter);
      if (outbreak) {
        // we have the outbreak instance; check filter for outbreak properties
        Object.keys(foreignKeyQuery).forEach(prop => {
          if (
            typeof foreignKeyQuery[prop] === 'string' &&
            foreignKeyQuery[prop].indexOf('outbreak.') === 0
          ) {
            // replace the filter value with the outbreak property value only if found
            const value = _.get(outbreak, foreignKeyQuery[prop].substring(9));
            value && (foreignKeyQuery[prop] = value);
          }
        });
      }
    }

    jobs[fKey] = function (callback) {
      // construct query following rawFind logic
      // get default scope query, if any
      const defaultScopeQuery = _.get(require(`./../common/models/${foreignKeyInfo.modelName}.json`), 'scope.where');
      let query = foreignKeyQuery;
      // if there is a default scope query
      if (defaultScopeQuery) {
        // merge it in the sent query
        query = {
          $and: [
            defaultScopeQuery,
            query
          ]
        };
      }

      // make sure filter is valid for mongodb
      query = convertLoopbackFilterToMongo(query);

      // query only non deleted data
      if (!query['$and']) {
        query = {
          $and: [
            query,
            {
              deleted: false
            }
          ]
        };
      } else {
        query['$and'].push({
          deleted: false
        });
      }

      // Note: This query will retrieve all data from the related model
      // depending on data quantity might cause javascript heap out of memory error
      // should be used only for models with limited number of instances
      return MongoDBHelper.executeAction(
        foreignKeyInfo.collectionName,
        'find',
        [
          query,
          {
            projection: {
              [foreignKeyInfo.labelProperty]: 1
            }
          }
        ])
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

/**
 * Get a list of available reference data items for each property of the model
 * @param outbreakId
 * @param modelReferenceDataFieldsToCategoryMap
 * @return {Promise.<T>}
 */
const getReferenceDataAvailableValuesForModel = function (outbreakId, modelReferenceDataFieldsToCategoryMap) {
  const referenceDataValues = {};
  // find (active) reference data for the referenced categories
  return baseReferenceDataModel.helpers
    .getSystemAndOutbreakReferenceData(outbreakId, {
      where: {
        categoryId: {
          inq: Object.values(modelReferenceDataFieldsToCategoryMap)
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
      Object.keys(modelReferenceDataFieldsToCategoryMap).forEach(function (modelProperty) {
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
            referenceDataValues[propertyComponents[0]][propertyComponents[1]] = referenceDataItemsByCategory[modelReferenceDataFieldsToCategoryMap[modelProperty]] || [];
          }
        } else {
          // no sub components, store property directly
          referenceDataValues[modelProperty] = referenceDataItemsByCategory[modelReferenceDataFieldsToCategoryMap[modelProperty]] || [];
        }
      });
      return referenceDataValues;
    });
};

/**
 * Get mapping suggestions for model extended form
 * @param outbreak
 * @param importType ( json, xls... )
 * @param modelExtendedForm
 * @param headers
 * @param normalizedHeaders
 * @param languageDictionary
 * @param dataset
 * @return {Object}
 */
const getMappingSuggestionsForModelExtendedForm = function (outbreak, importType, modelExtendedForm, headers, normalizedHeaders, languageDictionary, dataset, fieldsMap) {
  // make sure we have a valid type
  importType = importType ? importType.toLowerCase() : '.json';

  // start building a result
  const result = {
    suggestedFieldMapping: {},
    modelProperties: {
      [modelExtendedForm.containerProperty]: {}
    },
    modelPropertyValues: {},
    modelArrayProperties: {}
  };

  // construct variable name
  const getVarName = (variable) => {
    return variable.name;
  };

  // extract variables from template
  const variables = helpers.extractVariablesAndAnswerOptions(outbreak[modelExtendedForm.template]);

  // if variables are present
  if (variables.length) {
    // normalize them
    const normalizedVariables = variables.map(function (variable) {
      result.modelProperties[modelExtendedForm.containerProperty][getVarName(variable)] = variable.text;
      return stripSpecialCharsToLowerCase(languageDictionary.getTranslation(variable.text));
    });
    // try to find mapping suggestions
    normalizedHeaders.forEach(function (normalizedHeader, index) {
      let propIndex = normalizedVariables.indexOf(normalizedHeader);
      if (propIndex !== -1) {
        result.suggestedFieldMapping[headers[index]] = `${modelExtendedForm.containerProperty}.${variables[propIndex].name}`;
      }
    });
    // go through the variables
    variables.forEach(function (variable) {
      // if answers were defined for a variable
      if (variable.answers) {
        // store available values list for the extended form
        if (!result.modelPropertyValues[modelExtendedForm.containerProperty]) {
          result.modelPropertyValues[modelExtendedForm.containerProperty] = {};
        }
        const answers = [];
        // store the answers
        variable.answers.forEach(function (answer) {
          answers.push(Object.assign({id: answer.value}, answer));
        });

        // add them to the available values
        result.modelPropertyValues[modelExtendedForm.containerProperty][getVarName(variable)] = answers;
      }
    });
  }

  if (['.json'].includes(importType)) {
    const multiDateQuestions = outbreak[modelExtendedForm.template].filter(q => q.multiAnswer);

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
    const containerProp = modelExtendedForm.containerProperty;
    const containerPropTranslation = languageDictionary.getTranslation(fieldsMap[containerProp]);

    const maxAnswersMap = helpers.getQuestionnaireMaxAnswersMap(
      multiDateQuestions,
      dataset,
      {containerPropTranslation, questionToTranslationMap}
    );

    for (let variable in maxAnswersMap) {
      result.modelArrayProperties[`${containerProp}.${variable}`] = {
        maxItems: maxAnswersMap[variable]
      };
    }
  }

  return result;
};

/**
 * Calculate maxim number of items an array properties has across multiple records
 * @param records
 */
const getArrayPropertiesMaxLength = function (records) {
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
};

/**
 * Upload an importable file, parse it and create/return map for import action
 * @param file
 * @param decryptPassword
 * @param outbreak
 * @param languageId
 * @param options
 * @returns {Promise<unknown>}
 */
const upload = function (file, decryptPassword, outbreak, languageId, options) {
  const outbreakId = outbreak.id;

  // load language dictionary for the user
  let languageDictionary;
  return baseLanguageModel.helpers.getLanguageDictionary(languageId)
    .then(dictionary => {
      languageDictionary = dictionary;

      // store the file and get its headers
      return storeFileAndGetHeaders(
        file,
        decryptPassword,
        options,
        dictionary,
        // questionnaire template
        outbreak[options.extendedForm.template]);
    })
    .then(result => {
      // get file extension
      const extension = path.extname(file.name);

      // keep e reference to parsed content
      const dataSet = result.jsonObj;
      // define main result
      result = {
        id: result.id,
        fileHeaders: result.headers
      };

      // store results for multiple models
      const results = {};
      // define normalized headers, they will be updated (conditionally) later
      let normalizedHeaders = {};
      // store a list of steps that will be executed
      const steps = [];
      // store main model name
      const mainModelName = options.modelName;

      // go through the list of models associated with the passed model name
      const associatedModelsOptions = options.associatedModels;
      Object.keys(associatedModelsOptions).forEach(modelName => {
        const assocModelOptions = associatedModelsOptions[modelName];

        // each model has its own results
        results[modelName] = {
          modelProperties: {},
          suggestedFieldMapping: {},
          modelPropertyValues: {},
          modelArrayProperties: {}
        };

        // if file headers were found
        if (result.fileHeaders.length) {
          // normalize the headers if they were not previously normalized
          if (!Object.keys(normalizedHeaders).length) {
            // normalize file headers
            normalizedHeaders = result.fileHeaders.map(function (header) {
              return stripSpecialCharsToLowerCase(header);
            });
          }

          // get model's field labels map
          const fieldLabelsMap = assocModelOptions.fieldLabelsMap || {};
          // if the model has importable properties, get their headers and try to suggest some mappings
          if (assocModelOptions.importableProperties && assocModelOptions.importableProperties.length) {
            steps.push(function (callback) {
              // normalize model headers (property labels)
              const normalizedModelProperties = assocModelOptions.importableProperties.map(function (property) {
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
                  results[modelName].suggestedFieldMapping[result.fileHeaders[index]] = assocModelOptions.importableProperties[propIndex];
                }
              });
              callback(null, results[modelName]);
            });
          }

          // if the model uses reference data for its properties
          if (assocModelOptions.referenceDataFieldsToCategoryMap) {
            steps.push(function (callback) {
              // get reference data
              getReferenceDataAvailableValuesForModel(outbreakId, assocModelOptions.referenceDataFieldsToCategoryMap)
                .then(function (referenceDataValues) {
                  // update result
                  results[modelName] = Object.assign({}, results[modelName], {modelPropertyValues: _.merge(results[modelName].modelPropertyValues, referenceDataValues)});
                  callback(null, results[modelName]);
                })
                .catch(callback);
            });
          }

          // if the model has fk for its properties
          if (assocModelOptions.foreignKeyFields) {
            steps.push(function (callback) {
              // get foreign keys values
              getForeignKeysValues(assocModelOptions.foreignKeyFields, outbreak)
                .then(foreignKeysValues => {
                  // update result
                  results[modelName] = Object.assign({}, results[modelName], {modelPropertyValues: _.merge(results[modelName].modelPropertyValues, foreignKeysValues)});
                  callback(null, results[modelName]);
                })
                .catch(callback);
            });
          }

          // if outbreakId was sent (templates are stored at outbreak level) and the model uses extended form template
          if (outbreakId !== undefined && assocModelOptions.extendedForm && assocModelOptions.extendedForm.template) {
            // get mapping suggestions for extended form
            steps.push(function (callback) {
              const extendedFormSuggestions = getMappingSuggestionsForModelExtendedForm(outbreak, extension, assocModelOptions.extendedForm, result.fileHeaders, normalizedHeaders, languageDictionary, dataSet, fieldLabelsMap);
              // update result
              results[modelName] = Object.assign(
                {}, results[modelName],
                {suggestedFieldMapping: Object.assign(results[modelName].suggestedFieldMapping, extendedFormSuggestions.suggestedFieldMapping)},
                {modelProperties: Object.assign(results[modelName].modelProperties, extendedFormSuggestions.modelProperties)},
                {modelPropertyValues: Object.assign(results[modelName].modelPropertyValues, extendedFormSuggestions.modelPropertyValues)},
                {modelArrayProperties: Object.assign(results[modelName].modelArrayProperties, extendedFormSuggestions.modelArrayProperties)}
              );
              callback(null, results[modelName]);
            });
          }

          // get array properties maximum length for non-flat files
          if (['.json'].includes(extension)) {
            steps.push(callback => {
              results[modelName].fileArrayHeaders = getArrayPropertiesMaxLength(dataSet);
              return callback(null, results[modelName]);
            });
          }

          // reference data has categoryId as a 'reference data' type but is not related to other reference data, it is reference data
          if (modelName === options.referenceDataModelName) {
            steps.push(function (callback) {
              // add categoryId as a reference data item
              results[modelName] = Object.assign({}, results[modelName], {
                modelPropertyValues: Object.assign(results[modelName].modelPropertyValues, {
                  categoryId: options.referenceDataAvailableCategories.map(item => Object.assign({label: item.name}, item))
                })
              });
              callback();
            });
          }
        }
      });

      return new Promise((resolve, reject) => {
        // execute the list of steps
        async.series(steps, function (error) {
          // handle errors
          if (error) {
            return reject(error);
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
          resolve(result);
        });
      });
    });
};

/**
 * Get distinct values from file for given headers
 * @param {string} fileId - File ID
 * @param {Array} headers - Headers list for which to get distinct values
 * @returns {Promise<{distinctFileColumnValues: {}}>}
 */
const getDistinctValuesForHeaders = function (fileId, headers) {
  // get JSON
  return getTemporaryFileById(fileId)
    .then(fileContents => {
      return {
        distinctFileColumnValues: getDistinctPropertyValues(fileContents, headers)
      };
    });
};

/**
 * Process importable file data
 * Format it in worker and process the formatted data
 * @param body
 * @param options
 * @param callback
 */
const processImportableFileData = function (app, options, formatterOptions, batchHandler, callback) {
  // initialize functions containers for child process communication
  let sendMessageToWorker, stopWorker;

  // get logger
  const logger = options.logger;

  // define data counters
  let processed = 0;
  let total;

  // initialize flag to know if the worker is stopped (by us or error)
  let stoppedWorker = false;

  // initialize flag to know if we have a batch in progress
  let batchInProgress = false;

  // initialize cache for import log entry
  let importLogEntry;

  // initialize counters to know that there were some errors or some successful imports
  let importErrors = 0;
  let importSuccess = 0;

  /**
   * Create and send response; Either success or error response
   * Handles premature failure of import; Can happen when the worked stops before sending all data
   * @returns {*}
   */
  const updateImportLogEntry = function () {
    // check for premature failure
    if (processed !== total) {
      // add errors for all rows not processed
      const createErrors = [];
      const notProcessedError = app.utils.apiError.getError('IMPORT_DATA_NOT_PROCESSED');
      for (let i = processed + 1; i <= total; i++) {
        importErrors++;
        createErrors.push({
          _id: uuid.v4(),
          importLogId: importLogEntry.id,
          error: notProcessedError,
          recordNo: i,
          deleted: false
        });
      }

      saveErrorsFromBatch(createErrors);
    }

    // initialize update payload
    let updatePayload = {
      actionCompletionDate: new Date(),
      processedNo: total
    };

    // if import errors were found
    if (importErrors) {
      // error with partial success
      updatePayload.status = importSuccess ? 'LNG_SYNC_STATUS_SUCCESS_WITH_WARNINGS' : 'LNG_SYNC_STATUS_FAILED';
      updatePayload.result = app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
        model: options.modelName,
        success: importSuccess,
        failed: importErrors
      });
    } else {
      updatePayload.status = 'LNG_SYNC_STATUS_SUCCESS';
    }

    // save log entry
    importLogEntry
      .updateAttributes(updatePayload)
      .then(() => {
        logger.debug(`Import finished and import log entry (${importLogEntry.id}) update succeeded`);
      })
      .catch(err => {
        logger.debug(`Import finished but import log entry (${importLogEntry.id}) update failed with error ${err}. Import log payload: ${JSON.stringify(updatePayload)}`);
      });
  };

  /**
   * Save errors from a batch in DB
   * @param {Array} batchErrors - Array of error objects
   * @returns {Promise<T> | Promise<unknown>}
   */
  const saveErrorsFromBatch = function (batchErrors) {
    // create Mongo DB connection
    return MongoDBHelper
      .getMongoDBConnection()
      .then(dbConn => {
        const importResultCollection = dbConn.collection('importResult');

        // encode properties if necessary
        const restrictedCharactersRegex = /\.|\$|\\/g;
        const escapeRestrictedMongoCharacters = (value) => {
          if (Array.isArray(value)) {
            value.forEach((item) => {
              escapeRestrictedMongoCharacters(item);
            });
          } else if (typeof value === 'object') {
            Object.keys(value).forEach((key) => {
              // make sure we look further into children values
              escapeRestrictedMongoCharacters(value[key]);

              // replace property
              if (restrictedCharactersRegex.test(key)) {
                const newKey = key.replace(restrictedCharactersRegex, '_');
                value[newKey] = value[key];
                delete value[key];
              }
            });
          } else {
            // NO NEED TO MAKE CHANGES
          }
        };

        // escape
        escapeRestrictedMongoCharacters(batchErrors);

        // bulk insert
        return importResultCollection
          .insertMany(batchErrors);
      })
      .catch(err => {
        logger.debug('Failed saving batch errors' + JSON.stringify({
          err: err,
          errors: batchErrors
        }));
      });
  };

  /**
   * Action to be executed when a message is sent from the child process
   * @param message
   */
  const actionOnMessageFromChild = function (err, message) {
    if (err) {
      // errors with the child process; we received errors or closing messages when we stopped the child process
      if (!stoppedWorker) {
        // we didn't stop the process and it was an actual error
        logger.debug(`Worker error. Err: ${JSON.stringify(err)}`);
        stoppedWorker = true;

        if (batchInProgress) {
          // processing will stop once in progress batch is finished
        } else {
          if (!total) {
            // error was encountered before worker started processing
            return callback(err);
          }

          // send response with the data that we have until now
          updateImportLogEntry();
        }
      } else {
        // worker is already stopped; this is a close/disconnect error; nothing to do as we closed the worker
      }

      return;
    }

    // depending on message we need to make different actions
    switch (message.subject) {
      case 'start': {
        // save total number of resources
        total = message.totalNo;
        logger.debug(`Number of resources to be imported: ${total}`);

        // create import log entry
        app.models.importLog
          .create({
            actionStartDate: new Date(),
            status: 'LNG_SYNC_STATUS_IN_PROGRESS',
            resourceType: options.modelName,
            totalNo: total,
            processedNo: 0,
            outbreakIDs: [options.outbreakId]
          })
          .then(result => {
            // cache log entry
            importLogEntry = result;

            // send response; don't wait for import
            callback(null, importLogEntry.id);

            // get next batch
            sendMessageToWorker({
              subject: 'nextBatch'
            });
          })
          .catch(err => {
            // failed creating import log entry
            // stop worker
            stopWorker();

            // return error
            callback(err);
          });

        break;
      }
      case 'nextBatch': {
        // starting batch processing
        batchInProgress = true;

        // get data
        const batchData = message.data;
        const batchSize = batchData.length;

        logger.debug(`Received ${batchSize} items from worker`);

        // get operations to be executed for batch
        const operations = batchHandler(batchData);

        // run batch operations; will never error
        // some actions support parallel processing some don't
        async.parallelLimit(operations, options.parallelActionsLimit || 1, function (err, results) {
          // check results and increase counters
          const createErrors = [];
          results.forEach((itemResult, index) => {
            if (!itemResult || itemResult.success !== false) {
              // success
              importSuccess++;
              return;
            }

            // item failed
            importErrors++;

            createErrors.push(Object.assign({
              _id: uuid.v4(),
              importLogId: importLogEntry.id,
              recordNo: processed + index + 1,
              deleted: false
            }, itemResult.error || {}));
          });

          // increase processed counter
          processed += batchSize;
          logger.debug(`Resources processed: ${processed}/${total}`);

          // finished batch
          batchInProgress = false;

          // save any errors
          if (createErrors.length) {
            saveErrorsFromBatch(createErrors);
          }

          // check if we still have data to process
          if (processed < total) {
            // check if worker is still active
            if (!stoppedWorker) {
              logger.debug('Processing next batch');

              // save log entry
              const updatePayload = {
                processedNo: processed
              };
              if (importErrors) {
                updatePayload.result = app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                  model: options.modelName,
                  success: importSuccess,
                  failed: importErrors
                });
              }
              importLogEntry
                .updateAttributes(updatePayload)
                .catch(err => {
                  logger.debug(`Import in progress but import log entry (${importLogEntry.id}) update failed with error ${err}. Import log payload: ${JSON.stringify(updatePayload)}`);
                })
                .then(() => {
                  // get next batch; doesn't matter if import log entry update succeeded or failed
                  sendMessageToWorker({
                    subject: 'nextBatch'
                  });
                });
            } else {
              // save response with data that we have until now
              updateImportLogEntry();
            }

            return;
          }

          // all data has been processed
          logger.debug('All data was processed');
          // stop child process if not already stopped
          if (!stoppedWorker) {
            stopWorker();
          }

          updateImportLogEntry();
        });

        break;
      }
      case 'finished': {
        // worker will send this message once it has processed all data
        if (!stoppedWorker) {
          stopWorker();
        }
        break;
      }
      case 'log': {
        logger.debug(message.log);
        break;
      }
      default:
        // unhandled message
        logger.debug(`Worker sent invalid message subject '${message.subject}'`);
        stopWorker();

        if (batchInProgress) {
          // processing will stop once current batch is finished
        } else {
          if (total === undefined) {
            // error was encountered before worker started processing
            // no log entry was created; return error
            return callback(err);
          }

          // send response with the data that we have until now
          updateImportLogEntry();
        }

        break;
    }
  };

  try {
    // start child process
    const workerCommunication = WorkerRunner.importableFile
      .importImportableFileUsingMap(formatterOptions, actionOnMessageFromChild);

    // cache child process communication functions
    sendMessageToWorker = workerCommunication.sendMessageToWorker;
    stopWorker = () => {
      stoppedWorker = true;
      workerCommunication.stopWorker();
    };
  } catch (err) {
    callback(err);
  }
};

module.exports = {
  upload,
  getDistinctValuesForHeaders,
  getTemporaryFileById,
  processImportableFileData
};
