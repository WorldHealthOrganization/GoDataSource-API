'use strict';

// dependencies
const moment = require('moment');
const chunkDateRange = require('chunk-date-range');
const _ = require('lodash');
const apiError = require('./apiError');
const xml2js = require('xml2js');
const spreadSheetFile = require('./spreadSheetFile');
const pdfDoc = require('./pdfDoc');
const streamUtils = require('./streamUtils');
const async = require('async');

/**
 * Convert a Date object into moment UTC date and reset time to start of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the day of the week will not be changed
 */
const getUTCDate = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).startOf('day') : moment.utc().startOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment UTC date and reset time to end of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the date will not be changed
 */
const getUTCDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).endOf('day') : moment.utc().endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Remove non-ASCII chars from a string
 * @param string
 * @return {*}
 */
const getAsciiString = function (string) {
  return string.replace(/[^\x00-\x7F]/g, '');
};

/**
 * Split a date interval into chunks of specified length
 * @param interval Array containing the margin dates of the interval
 * @param chunk String Length of each resulted chunk; Can be a daily/weekly/monthly
 * @returns {{}} Map of chunks
 */
const getChunksForInterval = function (interval, chunk) {
  // initialize map for chunkDateRange chunk values
  let chunkMap = {
    day: 'day',
    week: 'week',
    month: 'month'
  };
  // set default chunk to 1 day
  chunk = chunk ? chunkMap[chunk] : chunkMap.day;

  // get chunks
  // Note chunkDateRange doesn't include the last day in the interval so we add a day
  let chunks = chunkDateRange(interval[0], interval[1], chunk);

  // initialize result
  let result = {};

  // parse the chunks and create map with UTC dates
  chunks.forEach(function (chunk, index) {
    // get the chunk margins and format to UTC
    let start = getUTCDate(chunk.start);
    // chunkDateRange uses for both start and end 00:00 hours;
    // we use 23:59 hours for end so we need to get the end of day for the previous day except for the last day in the interval since we already send it at 23:59 hours
    let end = getUTCDateEndOfDay(chunk.end);
    if (index !== chunks.length - 1) {
      end.add(-1, 'd')
    }

    // create period identifier
    let identifier = start.toString() + ' - ' + end.toString();

    // store period entry in the map
    result[identifier] = {
      start: start,
      end: end
    }
  });

  return result;
};

/**
 * Remap a list of items using a map. Optionally remap their values using a values map
 * @param list
 * @param fieldsMap
 * @param [valuesMap]
 * @return {Array}
 */
const remapProperties = function (list, fieldsMap, valuesMap) {
  // store final result
  let results = [];
  // get a list of source fields
  let fields = Object.keys(fieldsMap);
  // go through the list of items
  list.forEach(function (item) {
    // build each individual item
    let result = {};
    // go trough the list of fields
    fields.forEach(function (field) {
      if (fieldsMap[field]) {
        // if no array position was specified, use position 0
        fieldsMap[field] = fieldsMap[field].replace(/\[]/g, '[0]');
        // remap property
        _.set(result, fieldsMap[field], item[field]);
        // if a values map was provided
        if (valuesMap && valuesMap[field] && valuesMap[field][item[field]] !== undefined) {
          // remap the values
          _.set(result, fieldsMap[field], valuesMap[field][item[field]]);
        }
      }
    });
    // add processed item to the final list
    results.push(result);
  });
  return results;
};

/**
 * Convert filter date attributes from string to date
 * @param obj
 */
const convertPropsToDate = function (obj) {
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (typeof obj[prop] == 'object' && obj[prop] !== null) {
        convertPropsToDate(obj[prop]);
      } else {
        // initialize date regexp
        let dateRegexp = /^\d{4}-\d{2}-\d{2}[\sT]?(?:\d{2}:\d{2}:\d{2}\.\d{3}Z*)?$/;

        // we're only looking for strings properties that have a date format to convert
        if (typeof obj[prop] === 'string' && dateRegexp.test(obj[prop])) {
          // try to convert the string value to date, if valid, replace the old value
          let convertedDate = moment(obj[prop]);
          if (convertedDate.isValid()) {
            obj[prop] = convertedDate.toDate();
          }
        }
      }
    }
  }
};

/**
 * Extract only the importable fields for a model from a record data
 * @param Model
 * @param data
 */
const extractImportableFields = function (Model, data) {
  // store importable properties as part of a new object
  const importableFields = {};
  // go through all importable top level properties
  Model._importableTopLevelProperties.forEach(function (importableProperty) {
    // add the importable data (if it exists)
    if (data[importableProperty] !== undefined) {
      importableFields[importableProperty] = data[importableProperty];
    }
  });
  return importableFields;
};

/**
 * Get a JSON that has XML friendly property names
 * @param jsonObj
 * @return {*}
 */
const getXmlFriendlyJson = function (jsonObj) {
  // define a replacement
  let _replacement;
  // if the json is an array
  if (Array.isArray(jsonObj)) {
    // replacement must be an array
    _replacement = [];
    // go through all elements
    jsonObj.forEach(function (jsObj) {
      // and make them XML friendly
      _replacement.push(getXmlFriendlyJson(jsObj));
    });
  }
  // json is a non-empty object
  else if (typeof jsonObj === 'object' && jsonObj != null) {
    // replacement must be a non-empty object
    _replacement = {};
    // go trough all the object keys
    Object.keys(jsonObj).forEach(function (property) {
      // get XML friendly key
      let replacementProperty = _.camelCase(property);
      // if the value is a complex one
      if (typeof jsonObj[property] === 'object' && jsonObj != null) {
        // make it XML friendly
        _replacement[replacementProperty] = getXmlFriendlyJson(jsonObj[property]);
      } else {
        // otherwise just store it
        _replacement[replacementProperty] = jsonObj[property];
      }
    });
  } else {
    // empty object, just copy it
    _replacement = jsonObj;
  }
  return _replacement;
};

/**
 * Export a list in a file
 * @param headers file list headers
 * @param dataSet {Array} actual data set
 * @param fileType {enum} [json, xml, csv, xls, xlsx, ods, pdf]
 * @return {Promise<any>}
 */
const exportListFile = function (headers, dataSet, fileType) {

  // define the file
  const file = {
    data: {},
    mimeType: '',
    extension: fileType
  };

  // promisify the file
  return new Promise(function (resolve, reject) {
    // data set must be an array
    if (!Array.isArray(dataSet)) {
      return reject(new Error('Invalid dataSet. DataSet must be an array.'));
    }
    // handle each file individually
    switch (fileType) {
      case 'json':
        file.mimeType = 'application/json';
        // build headers map
        const jsonHeadersMap = headers.reduce(function (accumulator, currentValue) {
          accumulator[currentValue.id] = currentValue.header;
          return accumulator;
        }, {});
        file.data = JSON.stringify(remapProperties(dataSet, jsonHeadersMap),
          // replace undefined with null so the JSON will contain all properties
          function (key, value) {
            if (value === undefined) {
              value = null;
            }
            return value;
          }, 2);
        resolve(file);
        break;
      case 'xml':
        file.mimeType = 'text/xml';
        const builder = new xml2js.Builder();
        // build headers map
        const xmlHeadersMap = headers.reduce(function (accumulator, currentValue) {
          // XML needs a repeating "container" property in order to simulate an array
          accumulator[currentValue.id] = `entry.${currentValue.header}`;
          return accumulator;
        }, {});
        file.data = builder.buildObject(getXmlFriendlyJson(remapProperties(dataSet, xmlHeadersMap)));
        resolve(file);
        break;
      case 'csv':
        file.mimeType = 'text/csv';
        spreadSheetFile.createCsvFile(headers, dataSet, function (error, csvFile) {
          if (error) {
            return reject(error);
          }
          file.data = csvFile;
          resolve(file);
        });
        break;
      case 'xls':
        file.mimeType = 'application/vnd.ms-excel';
        spreadSheetFile.createXlsFile(headers, dataSet, function (error, xlsFile) {
          if (error) {
            return reject(error);
          }
          file.data = xlsFile;
          resolve(file);
        });
        break;
      case 'xlsx':
        file.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        spreadSheetFile.createXlsxFile(headers, dataSet, function (error, xlsxFile) {
          if (error) {
            return reject(error);
          }
          file.data = xlsxFile;
          resolve(file);
        });
        break;
      case 'ods':
        file.mimeType = 'application/vnd.oasis.opendocument.spreadsheet';
        spreadSheetFile.createOdsFile(headers, dataSet, function (error, odsFile) {
          if (error) {
            return reject(error);
          }
          file.data = odsFile;
          resolve(file);
        });
        break;
      case 'pdf':
        file.mimeType = 'application/pdf';
        pdfDoc.createPDFList(headers, dataSet, function (error, pdfFile) {
          if (error) {
            return reject(error);
          }
          file.data = pdfFile;
          resolve(file);
        });
        break;
      default:
        reject(apiError.getError('REQUEST_VALIDATION_ERROR', {errorMessages: `Invalid Export Type: ${fileType}. Supported options: json, xml, csv, xls, xlsx, ods, pdf`}));
        break;
    }
  });
};

/**
 * Get a referenced value. Similar to loDash _.get but it can map properties from arrays also
 * @param data Source Object
 * @param path Path to property e.g. addresses[].locationId
 * @return {*}
 */
const getReferencedValue = function (data, path) {
  // start with an empty result
  let result;
  // if the path contains arrays
  if (/\[]/.test(path)) {
    // result must be an array
    result = [];
    // ge position of the array marker
    const arrayMarkerPosition = path.indexOf('[]');
    // get path to the array
    const arrayPath = path.substring(0, arrayMarkerPosition);
    // get remaining part
    const remainingPath = path.substring(arrayMarkerPosition + 3);
    // go trough the array
    _.get(data, arrayPath, []).forEach(function (dataItem, index) {
      // if there still is a path left
      if (remainingPath) {
        // process it
        let currentResult = getReferencedValue(dataItem, remainingPath);
        if (!Array.isArray(currentResult)) {
          currentResult = [currentResult];
        }
        currentResult.forEach(function (resultItem) {
          result.push({
            value: resultItem.value,
            exactPath: `${arrayPath}[${index}].${resultItem.exactPath}`
          });
        })

      } else {
        // otherwise just push the result
        result.push(result = {
          value: dataItem,
          exactPath: `${arrayPath}[${index}]`
        });
      }
    });
  } else {
    // no arrays in the path, use loDash get
    result = {
      value: _.get(data, path),
      exactPath: path
    }
  }
  return result;
};

/**
 * Resolve foreign keys for a model in a result set (this includes reference data)
 * @param app
 * @param Model
 * @param resultSet
 * @param languageDictionary
 * @param [resolveReferenceData]
 * @return {Promise<any>}
 */
const resolveModelForeignKeys = function (app, Model, resultSet, languageDictionary, resolveReferenceData) {

  // by default also resolve reference data
  if (resolveReferenceData === undefined) {
    resolveReferenceData = true;
  }

  // promisify the response
  return new Promise(function (resolve, reject) {

    // build a list of queries (per model) in order to resolve foreign keys
    const foreignKeyQueryMap = {};
    // keep a flag for resolving foreign keys
    let resolveForeignKeys = false;

    // if the model has a resolver map
    if (Model.foreignKeyResolverMap) {
      // resolve foreign keys
      resolveForeignKeys = true;
    }

    // build a map of entries in the result set that should be resolved once we have foreign key data
    let resultSetResolverMap = {};

    // go through the resultSet
    resultSet.forEach(function (result, index) {
      // check if foreign keys should be resolved
      if (resolveForeignKeys) {
        // go through the list of keys that needs to be resolved
        Object.keys(Model.foreignKeyResolverMap).forEach(function (foreignKey) {
          // get foreign key value
          let foreignKeyValues = getReferencedValue(result, foreignKey);
          // if it's single value, convert it to array (simplify the code)
          if (!Array.isArray(foreignKeyValues)) {
            foreignKeyValues = [foreignKeyValues];
          }
          // go through all the foreign key values
          foreignKeyValues.forEach(function (foreignKeyValue) {
            // store the map for the result set entry, that will be resolved later
            resultSetResolverMap[`[${index}].${foreignKeyValue.exactPath}`] = {
              modelName: Model.foreignKeyResolverMap[foreignKey].modelName,
              value: foreignKeyValue.value,
              useProperty: Model.foreignKeyResolverMap[foreignKey].useProperty
            };
            // update the query map with the data that needs to be queried
            if (!foreignKeyQueryMap[Model.foreignKeyResolverMap[foreignKey].modelName]) {
              foreignKeyQueryMap[Model.foreignKeyResolverMap[foreignKey].modelName] = [];
            }
            foreignKeyQueryMap[Model.foreignKeyResolverMap[foreignKey].modelName].push(foreignKeyValue.value);
          });
        });
      }

      // also resolve reference data if needed
      if (resolveReferenceData) {
        // for the fields that use reference data (special type of foreign key)
        Model.referenceDataFields.forEach(function (field) {
          if (result[field]) {
            // get translation of the reference data
            result[field] = languageDictionary.getTranslation(result[field]);
          }
        });
      }
    });

    if (resolveForeignKeys) {
      // build a list of queries that will be executed to resolve foreign keys
      const queryForeignKeys = {};
      // go through the entries in the query map
      Object.keys(foreignKeyQueryMap).forEach(function (modelName) {
        // add query operation (per model name)
        queryForeignKeys[modelName] = function (callback) {
          app.models[modelName]
            .find({
              where: {
                id: {
                  inq: foreignKeyQueryMap[modelName]
                }
              }
            })
            .then(function (results) {
              callback(null, results);
            })
            .catch(callback);
        };
      });

      // query models to resolve foreign keys
      async.parallel(queryForeignKeys, function (error, foreignKeyQueryResults) {
        // handle error
        if (error) {
          return reject(error);
        }
        // map foreign key results to models and index them by recordId
        let foreignKeyResultsMap = {};
        Object.keys(foreignKeyQueryResults).forEach(function (modelName) {
          // create container for records
          foreignKeyResultsMap[modelName] = {};
          // index each instance using record Id
          foreignKeyQueryResults[modelName].forEach(function (modelInstance) {
            foreignKeyResultsMap[modelName][modelInstance.id] = modelInstance.toJSON();
          })
        });

        // replace foreign key references with configured related model value
        Object.keys(resultSetResolverMap).forEach(function (foreignKeyPath) {
          // use the values from foreignKeysResults map
          _.set(resultSet, foreignKeyPath, _.get(foreignKeyResultsMap, `${resultSetResolverMap[foreignKeyPath].modelName}.${resultSetResolverMap[foreignKeyPath].value}.${resultSetResolverMap[foreignKeyPath].useProperty}`));
        });
        // foreign keys resolved
        resolve(resultSet);
      });
    } else {
      // nothing more to resolve
      resolve(resultSet);
    }
  });
};

module.exports = {
  getUTCDate: getUTCDate,
  streamToBuffer: streamUtils.streamToBuffer,
  remapProperties: remapProperties,
  getUTCDateEndOfDay: getUTCDateEndOfDay,
  getAsciiString: getAsciiString,
  getChunksForInterval: getChunksForInterval,
  convertPropsToDate: convertPropsToDate,
  extractImportableFields: extractImportableFields,
  exportListFile: exportListFile,
  getReferencedValue: getReferencedValue,
  resolveModelForeignKeys: resolveModelForeignKeys
};
