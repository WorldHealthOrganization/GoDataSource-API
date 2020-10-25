'use strict';

const _ = require('lodash');
const async = require('async');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const os = require('os');
const xml2js = require('xml2js');
const xlsx = require('xlsx');
const sort = require('alphanum-sort');
const apiError = require('./apiError');
const helpers = require('./helpers');
const aesCrypto = require('./aesCrypto');
const baseLanguageModel = require('./baseModelOptions/language');
const baseReferenceDataModel = require('./baseModelOptions/referenceData');
const convertLoopbackFilterToMongo = require('./convertLoopbackFilterToMongo');
const MongoDBHelper = require('./mongoDBHelper');

// define a list of supported file extensions
const supportedFileExtensions = [
  '.json',
  '.xml',
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
    // build the list by looking at the properties of all elements (not all items have all properties)
    jsonObj.forEach(function (item) {
      // go through all properties of flatten item
      Object.keys(helpers.getFlatObject(item)).forEach(function (property) {
        const sanitizedProperty = property
          // don't replace basic types arrays ( string, number, dates etc )
          .replace(/\[\d+]$/g, '')
          // sanitize arrays containing objects object
          .replace(/\[\d+]/g, '[]')
          .replace(/^\[]\.*/, '');
        // add the header if not already included
        if (!headers.includes(sanitizedProperty)) {
          headers.push(sanitizedProperty);
        }
      });
    });

    // send back the parsed object and its headers
    callback(null, {obj: jsonObj, headers: headers});
  } catch (error) {
    // handle JSON.parse errors
    callback(apiError.getError('INVALID_CONTENT_OF_TYPE', {
      contentType: 'JSON',
      details: error.message
    }));
  }
};

/**
 * Get XML string as JSON and its headers
 * @param xmlString
 * @param modelOptions
 * @param dictionary
 * @param questionnaire
 * @param callback
 */
const getXmlHeaders = function ({data, modelOptions, dictionary, questionnaire}, callback) {
  const parserOpts = {
    explicitArray: true,
    explicitRoot: false
  };

  const questionsTypeMap = {};
  const arrayProps = modelOptions.arrayProps;
  // some models don't own a questionnaire
  // but surely we need an array map otherwise we can't decide which properties should be left as arrays
  // after parser converts arrays with 1 element to object
  if (arrayProps.length || questionnaire) {
    parserOpts.explicitArray = false;

    if (questionnaire) {
      // build a map of questions and their types
      (function traverse(questions) {
        return (questions || []).map(q => {
          questionsTypeMap[q.variable] = q.answerType;
          if (Array.isArray(q.answers) && q.answers.length) {
            for (let a of q.answers) {
              traverse(a.additionalQuestions);
            }
          }
        });
      })(questionnaire.toJSON());
    }
  }

  // parse XML string
  xml2js.parseString(data, parserOpts, function (error, jsonObj) {
    // handle parse errors
    if (error) {
      return callback(error);
    }
    // XML arrays are stored within a prop, get the first property of the object
    const firstProp = Object.keys(jsonObj).shift();

    // list of records to parse
    let records = jsonObj[firstProp];
    if (typeof records === 'object' && !Array.isArray(records)) {
      records = [records];
    }

    // build a list of headers
    const headers = [];
    records = records.map(record => {
      // convert array properties to correct format
      // this is needed because XML might contain a single element of type array props
      // and the parser is converting it into object, rather than array, cause has only one
      for (let propName in record) {
        if (arrayProps[propName] || arrayProps[dictionary.getTranslation(propName)]) {
          if (!Array.isArray(record[propName]) && typeof record[propName] === 'object') {
            record[propName] = [record[propName]];
          }
        }
      }

      // parse questions from XML
      // make sure multi answers/multi date questions are of type array
      if (record.questionnaireAnswers && Object.keys(questionsTypeMap).length) {
        for (let q in record.questionnaireAnswers) {
          if (record.questionnaireAnswers.hasOwnProperty(q)) {
            const questionType = questionsTypeMap[q];

            // make sure answers is an array
            if (!Array.isArray(record.questionnaireAnswers[q])) {
              record.questionnaireAnswers[q] = [record.questionnaireAnswers[q]];
            }
            if (questionType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
              // go through each answers, make sure value is array
              record.questionnaireAnswers[q] = record.questionnaireAnswers[q].map(a => {
                if (!Array.isArray(a.value)) {
                  a.value = [a.value];
                }
                return a;
              });
            }
          }
        }
      }

      // go through all properties of flatten item
      Object.keys(helpers.getFlatObject(record))
        .forEach(function (property) {
          const sanitizedProperty = property
            // don't replace basic types arrays ( string, number, dates etc )
            .replace(/\[\d+]$/g, '')
            // sanitize arrays containing objects object
            .replace(/\[\d+]/g, '[]')
            .replace(/^\[]\.*/, '');
          // add the header if not already included
          if (!headers.includes(sanitizedProperty)) {
            headers.push(sanitizedProperty);
          }
        });
      return record;
    });
    // send back the parsed object and its headers
    callback(null, {obj: records, headers: headers});
  });
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
  switch (extension) {
    case '.json':
      getHeaders = getJsonHeaders;
      break;
    case '.xml':
      getHeaders = getXmlHeaders;
      break;
    case '.csv':
    case '.xls':
    case '.xlsx':
    case '.ods':
      getHeaders = getSpreadSheetHeaders;
      break;
  }

  return new Promise((resolve, reject) => {
    fs.readFile(file.path, function (error, buffer) {
      // handle error
      if (error) {
        return reject(error);
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
            // store file on dist
            temporaryStoreFileOnDisk(JSON.stringify(result.obj), function (error, fileId) {
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
 * Get a list of distinct values for each property of the dataset
 * @param dataSet
 */
const getDistinctPropertyValues = function (dataSet) {
  // flatten object
  const flatDataSet = helpers.getFlatObject(dataSet);
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
              deleted: {
                $ne: true
              }
            }
          ]
        };
      } else {
        query['$and'].push({
          deleted: {
            $ne: true
          }
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
          {[foreignKeyInfo.labelProperty]: 1}
        ])
        .then(items => {
          return callback(null, items.map(item => {
            return {
              id: item._id,
              label: item[foreignKeyInfo.labelProperty],
              value: item._id
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
 * @param importType ( json, xml, xls... )
 * @param modelExtendedForm
 * @param headers
 * @param normalizedHeaders
 * @param languageDictionary
 * @param dataset
 * @return {Promise.<T>}
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

  if (['.json', '.xml'].includes(importType)) {
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
        fileHeaders: result.headers,
        distinctFileColumnValues: {}
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
            // get distinct property values
            result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
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
            // get distinct property values (if not taken already)
            if (!Object.keys(result.distinctFileColumnValues).length) {
              result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
            }
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
            // get distinct property values (if not taken already)
            if (!Object.keys(result.distinctFileColumnValues).length) {
              result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
            }
            // get mapping suggestions for extended form
            steps.push(function (callback) {
              getMappingSuggestionsForModelExtendedForm(outbreak, extension, assocModelOptions.extendedForm, result.fileHeaders, normalizedHeaders, languageDictionary, dataSet, fieldLabelsMap)
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
          if (modelName === options.referenceDataModelName) {
            steps.push(function (callback) {
              // get distinct column values (if not taken already) (to map categoyId)
              if (!Object.keys(result.distinctFileColumnValues).length) {
                result.distinctFileColumnValues = getDistinctPropertyValues(dataSet);
              }
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

module.exports = {
  upload
};
