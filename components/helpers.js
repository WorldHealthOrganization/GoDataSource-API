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
const fs = require('fs');
const packageJson = require('../package');
const workerRunner = require('./workerRunner');
const crypto = require('crypto');

const arrayFields = {
  'addresses': 'address',
  'address': 'address',
  'documents': 'document',
  'dateRanges': 'dateRangeWithDetails',
  'person': 'person',
  'labResults': 'labResult',
  'relationships': 'relationship',
  'geoLocation': 'geolocation'
};

const nonModelObjects = {
  geolocation: {
    lat: 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_LAT',
    lng: 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_LNG'
  }
};

/**
 * Convert a Date object into moment date and reset time to start of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the day of the week will not be changed
 */
const getDate = function (date, dayOfWeek) {
  let momentDate = date ? moment(date).startOf('day') : moment().startOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment date and reset time to end of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the date will not be changed
 */
const getDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? moment(date).endOf('day') : moment().endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Remove non-ASCII chars from a string
 * @param string
 * @return {*}
 */
const getAsciiString = function (string) {
  /* eslint-disable no-control-regex */
  return string.replace(/[^\x00-\x7F]/g, '');
  /* eslint-enable no-control-regex */
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

  // make sure we're always dealing with moment dates
  interval[0] = getDate(interval[0]);
  interval[1] = getDateEndOfDay(interval[1]);

  // get chunks
  let chunks = chunkDateRange(interval[0], interval[1], chunk);

  // chunk-date-range does not correctly handle date differences between on 'month' chunks for consecutive months
  if (
    // check if chunk is month
    chunk === 'month' &&
    // if the module returned just one chunk
    chunks.length === 1 &&
    // but interval months are different and should return more than 1 chunk
    interval[0].get('month') !== interval[1].get('month')
  ) {
    // manually build chunks
    chunks = [
      {
        // first chunk is from the interval start date
        start: interval[0],
        // end is start of next month (one day gets subtracted later)
        end: getDateEndOfDay(interval[1]).startOf('month')
      },
      {
        // second chunk starts from the first day of the month for interval end date
        start: getDate(interval[1]).startOf('month'),
        // end date is interval end date
        end: interval[1]
      }
    ];
  }

  // initialize result
  let result = {};

  // parse the chunks and create map with UTC dates
  chunks.forEach(function (chunk, index) {
    // get the chunk margins and format to UTC
    let start = getDate(chunk.start);
    // chunkDateRange uses for both start and end 00:00 hours;
    // we use 23:59 hours for end so we need to get the end of day for the previous day except for the last day in the interval since we already send it at 23:59 hours
    let end = getDateEndOfDay(chunk.end);
    if (index !== chunks.length - 1) {
      end.add(-1, 'd');
    }

    // create period identifier
    let identifier = start.toString() + ' - ' + end.toString();

    // store period entry in the map
    result[identifier] = {
      start: start,
      end: end
    };
  });

  return result;
};

/**
 * Process a flat map into a a map that groups array properties under sub-entities
 * @param flatMap
 * @param prefix
 * @return {{prefix: *, map: {}}}
 */
function processMapLists(flatMap, prefix) {
  // build result structure
  const processedMap = {
    prefix: prefix,
    map: {}
  };
  // go through the map
  Object.keys(flatMap).forEach(function (sourcePath) {
    // look for array markers in the source path
    const sourceListMarkerIndex = sourcePath.indexOf('[]');
    // look for array markers in the destination path
    const destinationMarkerIndex = flatMap[sourcePath].indexOf('[]');
    // source map contains an array
    if (sourceListMarkerIndex !== -1) {
      // array to array map
      if (destinationMarkerIndex !== -1) {
        // get parent source path
        const parentSourcePath = sourcePath.substring(0, sourceListMarkerIndex);
        // init result map for parent property (if not already present)
        if (!processedMap.map[parentSourcePath]) {
          processedMap.map[parentSourcePath] = {};
        }
        // get remaining path
        const leftSourcePath = sourcePath.substring(sourceListMarkerIndex + 3);
        // assume there is nothing left to process
        const dataSetLeftToProcess = {};
        // if there still is path to be processed
        if (leftSourcePath.length) {
          // fill dataSet left to process
          dataSetLeftToProcess[sourcePath.substring(sourceListMarkerIndex + 3)] = flatMap[sourcePath].substring(destinationMarkerIndex + 3);
        }
        // merge existing map with the result of processing remaining map
        processedMap.map[parentSourcePath] = _.merge(
          processedMap.map[parentSourcePath],
          processMapLists(
            dataSetLeftToProcess,
            flatMap[sourcePath].substring(0, destinationMarkerIndex)
          )
        );
      } else {
        // unsupported scenario, cannot map array of objects to single object
      }
    } else {
      // simple map, no arrays
      processedMap.map[sourcePath] = flatMap[sourcePath];
    }
  });
  // return processed map
  return processedMap;
}

/**
 * Remap dataSet properties & values using a processed map
 * @param dataSet
 * @param processedMap
 * @param valuesMap
 * @param parentPath
 * @return {Array}
 */
function remapPropertiesUsingProcessedMap(dataSet, processedMap, valuesMap, parentPath) {
  // process only if there's something to process
  if (Array.isArray(dataSet)) {
    // initialize results container
    const results = [];
    // go through all the items in the dataSet
    dataSet.forEach(function (item) {
      // start building the result
      const result = {};
      // get source paths list
      const sourcePaths = Object.keys(processedMap.map);
      // if there are source paths to process
      if (sourcePaths.length) {
        // go through the source paths
        sourcePaths.forEach(function (sourcePath) {
          // build parent path prefix
          const parentPathPrefix = parentPath ? `${parentPath}.` : '';
          // if the source path is an object, it means that it contains children items that need to be processed
          if (typeof processedMap.map[sourcePath] === 'object') {
            // store children results after they were processed
            _.set(
              result,
              processedMap.map[sourcePath].prefix,
              // process children items
              remapPropertiesUsingProcessedMap(
                // get dataSet that needs to be processed
                _.get(item, sourcePath),
                // use sub-map
                processedMap.map[sourcePath],
                valuesMap,
                // build path to the item that's being processed (will be used by values mapper)
                `${parentPathPrefix}${sourcePath}[]`
              )
            );
            // simple mapping, no arrays
          } else {
            // get the resolved value
            const value = _.get(item, sourcePath);
            // define a replacement parent value
            let replaceValueParent;
            // check if the value has a replacement value defined
            if (
              value !== undefined &&
              typeof value !== 'object' &&
              valuesMap &&
              // strip indices for values map, we're only interested in the generic path not the exact one
              (replaceValueParent = valuesMap[`${parentPathPrefix.replace(/\[\d+]/g, '[]')}${sourcePath.replace(/\[\d+]/g, '[]')}`])
              && replaceValueParent[value] !== undefined
            ) {
              // use that replacement value
              _.set(result, `${processedMap.map[sourcePath]}`, replaceValueParent[value]);
            } else {
              // no replacement value defined, use resolved value
              _.set(result, `${processedMap.map[sourcePath]}`, value);
            }
          }
        });
        // store the result
        results.push(result);
      } else {
        // nothing to process, copy as is
        results.push(item);
      }
    });
    return results;
  }
}

/**
 * Remap a list of items using a map. Optionally remap their values using a values map
 * @param list
 * @param fieldsMap
 * @param [valuesMap]
 * @return {Array}
 */
const remapProperties = function (list, fieldsMap, valuesMap) {
  return remapPropertiesUsingProcessedMap(list, processMapLists(fieldsMap), valuesMap);
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

        // we're only looking for strings properties that have a date format to convert
        if (typeof obj[prop] === 'string' && isValidDate(obj[prop])) {
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
  // nothing to do if there is no data
  if (data) {
    // go through all importable top level properties
    Model._importableTopLevelProperties.forEach(function (importableProperty) {
      // add the importable data (if it exists)
      if (data[importableProperty] !== undefined) {
        importableFields[importableProperty] = data[importableProperty];
      }
    });
  }
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
 * Export a list in a file (synchronously)
 * @param headers file list headers
 * @param dataSet {Array} actual data set
 * @param fileType {enum} [json, xml, csv, xls, xlsx, ods, pdf]
 * @return {Promise<any>}
 */
const exportListFileSync = function (headers, dataSet, fileType, title = 'List') {

  /**
   * Build headers map in a way compatible with files that support hierarchical structures (XML, JSON)
   * @param headers
   */
  function buildHeadersMap(headers, jsonHeadersMap = {}) {
    // go trough the headers
    headers.forEach(function (header) {
      // get property level separator
      const separatorIndex = header.id.indexOf('.');
      // if the separator is found
      if (separatorIndex !== -1) {
        // get the property
        let property = '';
        // Different approaches for either objects or collections
        if (/\[]/.test(header.id)) {
          property = header.id.substring(0, separatorIndex);
        } else {
          property = header.id.substring(0, separatorIndex + 1);
        }
        // get the rest of the path
        const leftPath = header.id.substring(separatorIndex + 1);
        // if the property was not defined before
        if (!jsonHeadersMap[property]) {
          // define it
          jsonHeadersMap[property] = {};
        }
        // remap sub-levels
        jsonHeadersMap[property] = Object.assign({}, typeof (jsonHeadersMap[property]) === 'object' ? jsonHeadersMap[property] : {}, buildHeadersMap([{
          id: leftPath,
          header: header.header
        }], jsonHeadersMap[property]));
      } else {
        // simple property (one level) map it directly
        jsonHeadersMap[header.id] = header.header;
      }
    });
    return jsonHeadersMap;
  }

  /**
   * (deep) Remap object properties
   * @param source
   * @param headersMap
   */
  function objectRemap(source, headersMap) {
    // define result
    const result = {};
    // go through the headers map
    Object.keys(headersMap).forEach(function (header) {
      // if the map is for an array of complex elements
      if (header.endsWith('[]') && typeof headersMap[header] === 'object') {
        // remove array marker
        const _header = header.replace('[]', '');
        // result should be an array
        result[headersMap[_header]] = [];
        // if there is data in the source object
        if (source[_header]) {
          // go through each element
          source[_header].forEach(function (item) {
            // remap it and store it in the result
            result[headersMap[_header]].push(objectRemap(item, headersMap[header]));
          });
        } else {
          // just copy empty element
          result[headersMap[_header]] = source[_header];
        }
        // if the map is an object with mapped properties
      } else if (header.endsWith('.') && typeof headersMap[header] === 'object') {
        // remove array marker
        const _header = header.replace('.', '');
        // if there is data in the source object
        if (source[_header]) {
          // result should be an object
          result[headersMap[_header]] = objectRemap(source[_header], headersMap[header]);
        } else {
          // just copy empty element
          result[headersMap[_header]] = source[_header];
        }
        // type is an object
      } else if (typeof headersMap[header] === 'object') {
        // if the element is present in the source
        if (source[header]) {
          // remap it and add it in the result
          result[header] = objectRemap(source[header], headersMap[header]);
        } else {
          // just copy empty element in the result
          result[header] = source[header];
        }
        // array of simple elements
      } else if (header.endsWith('[]')) {
        // just copy them
        result[headersMap[header]] = source[header.replace('[]', '')];
        // simple element that was not yet mapped in the result (this is important as we may have labels for properties
        // like "addresses" and "addresses[]" and we don't want simple types to overwrite complex types)
      } else if (result[headersMap[header]] === undefined) {
        // copy the element in the result
        result[headersMap[header]] = source[header];
        // handle dates separately
        if (source[header] instanceof Date) {
          result[headersMap[header]] = getDateDisplayValue(source[header]);
        }
      }
    });
    return result;
  }

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

    let headersMap, remappedDataSet, builder;
    // handle each file individually
    switch (fileType) {
      case 'json':
        file.mimeType = 'application/json';
        // build headers map
        headersMap = buildHeadersMap(headers);
        remappedDataSet = dataSet.map(item => objectRemap(item, headersMap));
        file.data = JSON.stringify(remappedDataSet,
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
        builder = new xml2js.Builder();
        // build headers map
        headersMap = buildHeadersMap(headers);
        remappedDataSet = dataSet.map(function (item) {
          return {
            // XML does not have an array data type, repeating an "entry" will simulate an array
            entry: objectRemap(item, headersMap)
          };
        });
        // Make sure the response looks the same for single element arrays (native library behaviour is weird in this case)
        if (remappedDataSet.length === 1) {
          remappedDataSet = {root: remappedDataSet[0]};
        }
        file.data = builder.buildObject(getXmlFriendlyJson(remappedDataSet));
        resolve(file);
        break;
      case 'csv':
        file.mimeType = 'text/csv';
        spreadSheetFile.createCsvFile(headers, dataSet.map(item => getFlatObject(item, null, true)), function (error, csvFile) {
          if (error) {
            return reject(error);
          }
          file.data = csvFile;
          resolve(file);
        });
        break;
      case 'xls':
        file.mimeType = 'application/vnd.ms-excel';
        spreadSheetFile.createXlsFile(headers, dataSet.map(item => getFlatObject(item, null, true)), function (error, xlsFile) {
          if (error) {
            return reject(error);
          }
          file.data = xlsFile;
          resolve(file);
        });
        break;
      case 'xlsx':
        file.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        spreadSheetFile.createXlsxFile(headers, dataSet.map(item => getFlatObject(item, null, true)), function (error, xlsxFile) {
          if (error) {
            return reject(error);
          }
          file.data = xlsxFile;
          resolve(file);
        });
        break;
      case 'ods':
        file.mimeType = 'application/vnd.oasis.opendocument.spreadsheet';
        spreadSheetFile.createOdsFile(headers, dataSet.map(item => getFlatObject(item, null, true)), function (error, odsFile) {
          if (error) {
            return reject(error);
          }
          file.data = odsFile;
          resolve(file);
        });
        break;
      case 'pdf':
        file.mimeType = 'application/pdf';
        pdfDoc.createPDFList(headers, dataSet.map(item => getFlatObject(item, null, true)), title, function (error, pdfFile) {
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
 * Export a list in a file (asynchronously)
 * @param headers file list headers
 * @param dataSet {Array} actual data set
 * @param fileType {enum} [json, xml, csv, xls, xlsx, ods, pdf]
 * @return {Promise<any>}
 */
const exportListFile = workerRunner.helpers.exportListFile;

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
    // get position of the array marker
    const arrayMarkerPosition = path.indexOf('[]');
    // get path to the array
    const arrayPath = path.substring(0, arrayMarkerPosition);
    // get remaining part
    const remainingPath = path.substring(arrayMarkerPosition + 3);
    // go through the array
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
        });

      } else {
        // otherwise just push the result
        result.push({
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
    };
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
              key: foreignKey,
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
        translateDataSetReferenceDataValues(result, Model, languageDictionary);
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
            .rawFind({
              id: {
                inq: foreignKeyQueryMap[modelName]
              }
            })
            .then(function (results) {
              callback(null, results);
            })
            .catch(callback);
        };
      });

      // query models to resolve foreign keys
      async.parallelLimit(queryForeignKeys, 10, function (error, foreignKeyQueryResults) {
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
            foreignKeyResultsMap[modelName][modelInstance.id] = modelInstance;
          });
        });

        // replace foreign key references with configured related model value
        Object.keys(resultSetResolverMap).forEach(function (foreignKeyPath) {
          // if there are more values that should be mapped for one foreign key
          if (Array.isArray(resultSetResolverMap[foreignKeyPath].useProperty)) {
            // build a container for resolved values, container name is resolved model name
            let resolvedForeignKeyContainerPath = foreignKeyPath.replace(resultSetResolverMap[foreignKeyPath].key, resultSetResolverMap[foreignKeyPath].modelName);
            // go through all values that need to be mapped
            resultSetResolverMap[foreignKeyPath].useProperty.forEach(function (property) {
              // use the values from foreignKeysResults map
              _.set(
                resultSet,
                `${resolvedForeignKeyContainerPath}.${property}`,
                _.get(
                  foreignKeyResultsMap,
                  `${resultSetResolverMap[foreignKeyPath].modelName}.${resultSetResolverMap[foreignKeyPath].value}.${property}`));
            });
          } else {
            // use the values from foreignKeysResults map
            _.set(
              resultSet,
              foreignKeyPath,
              _.get(
                foreignKeyResultsMap,
                `${resultSetResolverMap[foreignKeyPath].modelName}.${resultSetResolverMap[foreignKeyPath].value}.${resultSetResolverMap[foreignKeyPath].useProperty}`));
          }
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

/**
 * Flatten a multi level object to single level
 * @param object
 * @param prefix
 * @param humanFriendly Use human friendly naming (e.g. "item 1 level sublevel" instead of "item[0].level.sublevel"). Default: false
 */
const getFlatObject = function (object, prefix, humanFriendly) {
  // define result
  let result = {};
  // replace null/undefined prefix with empty string to simplify later operations
  if (prefix == null) {
    prefix = '';
  }
  // by default do not use human friendly naming
  if (humanFriendly == null) {
    humanFriendly = false;
  }

  // define property name (it will be updated later)
  let propertyName;
  // if the object is an array
  if (Array.isArray(object)) {
    // go trough all elements
    object.forEach(function (item, index) {
      // build it's property name
      propertyName = `${prefix}[${index}]`;
      if (humanFriendly) {
        propertyName = `${prefix} ${index + 1}`.trim();
      }
      // if element is of complex type
      if (item && typeof item === 'object') {
        // process it
        result = Object.assign({}, result, getFlatObject(item, propertyName, humanFriendly));
      } else {
        // simple type
        result[propertyName] = item;
      }
    });
    // element is object
  } else if (typeof object === 'object') {
    // go through its properties
    Object.keys(object).forEach(function (property) {
      // build property name
      propertyName = prefix;
      if (humanFriendly) {
        propertyName = `${propertyName} ${property}`.trim();
      } else {
        if (propertyName.length) {
          propertyName = `${propertyName}.${property}`;
        } else {
          propertyName = property;
        }
      }
      // property is complex type
      if (object[property] && typeof object[property] === 'object') {
        // handle dates separately
        if (object[property] instanceof Date) {
          result[propertyName] = getDateDisplayValue(object[property]);
        } else {
          // process it
          result = Object.assign({}, result, getFlatObject(object[property], propertyName, humanFriendly));
        }
      } else {
        // simple type
        result[propertyName] = object[property];
      }
    });
  }
  return result;
};

/**
 * Format a date string for display purpose
 * @param dateString
 * @returns {string}
 */
const getDateDisplayValue = function (dateString) {
  return dateString && moment(dateString).isValid() ? new Date(dateString).toISOString() : dateString;
};

/**
 * Parse fields values
 * Note: The model instance JSON sent is updated
 * @param modelInstanceJSON JSON representation of a model instance
 * @param Model
 */
const parseModelFieldValues = function (modelInstanceJSON, Model) {
  if (Model.fieldsToParse && Model.fieldToValueParsersMap) {
    // if there are values that need to be parsed, parse them (eg date fields)
    Model.fieldsToParse.forEach(function (field) {
      let fieldValue = getReferencedValue(modelInstanceJSON, field);

      // field might be in an array; for that case we need to parse each array value
      if (Array.isArray(fieldValue)) {
        fieldValue.forEach(retrievedValue => _.set(modelInstanceJSON, retrievedValue.exactPath, Model.fieldToValueParsersMap[field](retrievedValue.value)));
      } else if (fieldValue.value) {
        _.set(modelInstanceJSON, fieldValue.exactPath, Model.fieldToValueParsersMap[field](fieldValue.value));
      }
    });
  }
};

/**
 * Checks if a directory/file is readable/writable and visible to the calling process
 * Access sync function is throwing error in case file is not ok
 * Make sure to treat it
 * @param path
 */
const isPathOK = function (path) {
  fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK);
};

/**
 * Format all the marked date type fields on the model
 * @param model
 * @param dateFieldsList
 * @returns {Object}
 */
const formatDateFields = function (model, dateFieldsList) {

  // Format date fields
  dateFieldsList.forEach((field) => {
    let reference = getReferencedValue(model, field);
    if (Array.isArray(reference)) {
      reference.forEach((indicator) => {
        _.set(model, indicator.exactPath, indicator.value ? getDateDisplayValue(indicator.value) : '');
      });
    } else {
      _.set(model, reference.exactPath, reference.value ? getDateDisplayValue(reference.value) : '');
    }
  });
};

/**
 * Format all undefined fields on the model
 * @param model
 */
const formatUndefinedValues = function (model) {
  Object.keys(model).forEach((key) => {
    if (Array.isArray(model[key])) {
      model[key].forEach((child) => {
        formatUndefinedValues(child);
      });
    } else if (typeof (model[key]) === 'object' && model[key] !== null) {
      formatUndefinedValues(model[key]);
    } else if (model[key] === undefined) {
      _.set(model, key, '');
    }
  });
};

/**
 * Translate all marked referenceData fields of a dataSet
 * @param dataSet
 * @param Model
 * @param dictionary
 */
const translateDataSetReferenceDataValues = function (dataSet, Model, dictionary) {
  if (Model.referenceDataFields) {
    if (!Array.isArray(dataSet)) {
      dataSet = [dataSet];
    }

    dataSet.forEach((model) => {
      Model.referenceDataFields.forEach((field) => {
        let reference = getReferencedValue(model, field);
        if (Array.isArray(reference)) {
          reference.forEach((indicator) => {
            _.set(model, indicator.exactPath, indicator.value ? dictionary.getTranslation(indicator.value) : '');
          });
        } else {
          _.set(model, reference.exactPath, reference.value ? dictionary.getTranslation(reference.value) : '');
        }
      });
    });
  }
};

/**
 * Translate all marked field labels of a model
 * @param app
 * @param modelName
 * @param model
 * @param dictionary
 */
const translateFieldLabels = function (app, model, modelName, dictionary) {
  let fieldsToTranslate = {};
  if (!app.models[modelName]) {
    fieldsToTranslate = nonModelObjects[modelName];
  } else {
    fieldsToTranslate = Object.assign(app.models[modelName].fieldLabelsMap, app.models[modelName].relatedFieldLabelsMap);
    model = _.pick(model, app.models[modelName].printFieldsinOrder);
  }

  let translatedFieldsModel = {};
  Object.keys(model).forEach(function (key) {
    let value = model[key];
    let newValue = value;
    if (fieldsToTranslate && fieldsToTranslate[key]) {
      if (Array.isArray(value) && value.length && typeof (value[0]) === 'object' && arrayFields[key]) {
        newValue = [];
        value.forEach((element, index) => {
          newValue[index] = translateFieldLabels(app, element, arrayFields[key], dictionary);
        });
      } else if (typeof (value) === 'object' && value !== null && Object.keys(value).length > 0) {
        newValue = translateFieldLabels(app, value, arrayFields[key], dictionary);
      }
      translatedFieldsModel[dictionary.getTranslation(app.models[modelName] ? fieldsToTranslate[key] : nonModelObjects[modelName][key])] = newValue;
    } else {
      translatedFieldsModel[key] = value;
    }
  });

  return translatedFieldsModel;
};

/**
 * When searching by a location, include all sub-locations
 * @param app
 * @param filter
 * @param callback
 */
const includeSubLocationsInLocationFilter = function (app, filter, callback) {
  // build a list of search actions
  const searchForLocations = [];
  // go through all filter properties
  Object.keys(filter).forEach(function (propertyName) {
    // search for the parentLocationIdFilter
    if (propertyName.includes('parentLocationIdFilter')) {
      // start with no location filter
      let parentLocationFilter;
      // handle string type
      if (typeof filter[propertyName] === 'string') {
        parentLocationFilter = [filter[propertyName]];
        // handle include type
      } else if (filter[propertyName] && typeof filter[propertyName] === 'object' && Array.isArray(filter[propertyName].inq)) {
        parentLocationFilter = filter[propertyName].inq;
      }
      // if a parent location filter was specified
      if (parentLocationFilter) {
        // search for sub-locations
        searchForLocations.push(function (callback) {
          app.models.location
            .getSubLocations(parentLocationFilter, [], function (error, locationIds) {
              if (error) {
                return callback(error);
              }
              // replace original filter with actual location filter and use found location ids
              filter[propertyName.replace('parentLocationIdFilter', 'locationId')] = {
                inq: locationIds
              };
              // remove original filter
              delete filter[propertyName];
              callback();
            });
        });
      }
    } else if (Array.isArray(filter[propertyName])) {
      // for array elements, go through all properties of the array
      filter[propertyName].forEach(function (item) {
        // if the item is an object
        if (item && typeof item === 'object') {
          // process it recursively
          searchForLocations.push(function (callback) {
            includeSubLocationsInLocationFilter(app, item, callback);
          });
        }
      });
    } else if (filter[propertyName] && typeof filter[propertyName] === 'object') {
      // if the element is an object
      searchForLocations.push(function (callback) {
        // process it recursively
        includeSubLocationsInLocationFilter(app, filter[propertyName], callback);
      });
    }
  });
  // perform searches
  async.series(searchForLocations, callback);
};

/**
 * Get Build Information
 * @return {{platform: *, type: *, version: *, build: *}}
 */
const getBuildInformation = function () {
  return {
    platform: _.get(packageJson, 'build.platform', '-'),
    type: _.get(packageJson, 'build.type', 'hub'),
    version: _.get(packageJson, 'build.version', _.get(packageJson, 'version')),
    build: _.get(packageJson, 'build.build', 'development'),
    process: {
      platform: process.platform,
      arch: process.arch
    }
  };
};

/**
 * Check if a (string) date is valid (correct ISO format)
 * @param date
 * @return {boolean}
 */
const isValidDate = function (date) {
  return /^\d{4}-\d{2}-\d{2}[\sT]?(?:\d{2}:\d{2}:\d{2}\.\d{3}Z*)?$/.test(date);
};

/**
 * Convert boolean model properties to correct boolean values from strings
 * @param Model
 * @param dataSet [object|array]
 */
const convertBooleanProperties = function (Model, dataSet) {
  // init model boolean properties, if not already done
  if (!Model._booleanProperties) {
    // keep a list of boolean properties
    Model._booleanProperties = [];
    // go through all model properties, from model definition
    Model.forEachProperty(function (propertyName) {
      // check if the property is supposed to be boolean
      if (
        Model.definition.properties[propertyName].type &&
        Model.definition.properties[propertyName].type.name === 'Boolean'
      ) {
        // store property name
        Model._booleanProperties.push(propertyName);
      }
    });
  }

  /**
   * Convert boolean model properties for a single record instance
   * @param record
   */
  function convertBooleanModelProperties(record) {
    // check each property that is supposed to be boolean
    Model._booleanProperties.forEach(function (booleanProperty) {
      // if it has a value but the value is not boolean
      if (record[booleanProperty] != null && typeof record[booleanProperty] !== 'boolean') {
        // convert it to boolean value
        record[booleanProperty] = ['1', 'true'].includes(record[booleanProperty].toString().toLowerCase());
      }
    });
  }

  // array of records
  if (Array.isArray(dataSet)) {
    // go through the dataSet records
    dataSet.forEach(function (record) {
      // convert each record
      convertBooleanModelProperties(record);
    });
    // single record
  } else {
    // convert record
    convertBooleanModelProperties(dataSet);
  }
  // records are modified by reference, but also return the dataSet
  return dataSet;
};

/**
 * Extract data source and target from model hook context
 * @param context
 */
const getSourceAndTargetFromModelHookContext = function (context) {
  const result = {};
  // data source & target can be on context instance
  if (context.instance) {
    // if this is an model instance
    if (typeof context.instance.toJSON === 'function') {
      // get data
      result.source = {
        existing: context.instance.toJSON(),
        existingRaw: context.instance,
        updated: {}
      };
    } else {
      result.source = {
        existing: context.instance,
        existingRaw: context.instance,
        updated: {}
      };
    }
    result.target = context.instance;
  } else {
    // data source & target are on context data
    if (context.currentInstance && typeof context.currentInstance.toJSON === 'function') {
      result.source = {
        existing: context.currentInstance.toJSON(),
        existingRaw: context.currentInstance,
        updated: context.data
      };
    } else {
      result.source = {
        existing: context.currentInstance,
        existingRaw: context.currentInstance,
        updated: context.data
      };
    }
    result.target = context.data;
  }
  result.source.all = Object.assign({}, result.source.existing, result.source.updated);
  return result;
};

/**
 * Translates a questionnaireAnswers property (from case, labResult and followUp documents) into an object that looks like
 *  this {question1Text: answerLabel, question2Text: answerLabel, ...}
 * @param outbreak
 * @param Model
 * @param modelInstance
 * @param dictionary
 * @returns {{}}
 */
const translateQuestionnaire = function (outbreak, Model, modelInstance, dictionary) {
  let newQuestionnaire = {};
  const questionnaireAnswers = convertQuestionnaireAnswersToOldFormat(modelInstance.questionnaireAnswers);
  Object.keys(questionnaireAnswers).forEach((variable) => {
    // shorthand ref
    let qAnswer = questionnaireAnswers[variable];

    // question definition
    let question = findQuestionByVariable(outbreak[Model.extendedForm.template], variable);

    if (question) {
      let questionText = dictionary.getTranslation(question.text);
      let answer = '';

      if (['LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS', 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER'].includes(question.answerType)) {
        answer = translateQuestionAnswers(question, qAnswer, dictionary);
      } else {
        // Parse date type answers since xml cannot print them
        if (qAnswer instanceof Date) {
          answer = getDateDisplayValue(qAnswer);
        } else {
          answer = qAnswer;
        }
      }
      newQuestionnaire[questionText] = answer;
    }
  });

  return newQuestionnaire;
};

/**
 * Replaces answer values with their translate labels
 * @param question
 * @param answers
 * @param dictionary
 * @returns {*}
 */
const translateQuestionAnswers = function (question, answers, dictionary) {
  let foundAnswer = {};
  if (!Array.isArray(answers)) {
    foundAnswer = _.find(question.answers, ['value', answers]);
    if (foundAnswer && foundAnswer.label) {
      return dictionary.getTranslation(foundAnswer.label);
    } else {
      // If the question no longer contains this answer, build the answer label and look for it's translation
      // in the dictionary. This case can appear when we remove a possible answer from a questionnaire, but there
      // are still models that contain this (now invalid) answer.
      return buildAndTranslateAnswerLabel(question.text, answers, dictionary);
    }
  } else {
    let translatedAnswers = [];
    answers.forEach((answer) => {
      foundAnswer = _.find(question.answers, ['value', answer]);
      if (foundAnswer && foundAnswer.label) {
        translatedAnswers.push(dictionary.getTranslation(foundAnswer.label));
      } else {
        // If the question no longer contains this answer, build the answer label and look for it's translation
        // in the dictionary. This case can appear when we remove a possible answer from a questionnaire, but there
        // are still models that contain this (now invalid) answer.
        translatedAnswers.push(buildAndTranslateAnswerLabel(question.text, answer, dictionary));
      }
    });
    return translatedAnswers;
  }
};

/**
 * Build an answer's label based on the question text and answer value and translate that label.
 * @param questionText
 * @param answerValue
 * @param dictionary
 * @returns {*}
 */
const buildAndTranslateAnswerLabel = function (questionText, answerValue, dictionary) {
  let result = answerValue;
  if (/_TEXT$/.test(questionText)) {
    let token = questionText.replace(/_TEXT$/, `_ANSWER_${_.upperCase(answerValue)}_LABEL`);
    let tokenTranslation = dictionary.getTranslation(token);
    if (token !== tokenTranslation) {
      result = tokenTranslation;
    }
  }
  return result;
};

/**
 * Return an outbreak's question, after searching for it using the "variable" field
 * @param questions
 * @param variable
 */
const findQuestionByVariable = function (questions, variable) {
  let result = _.find(questions, {'variable': variable,});
  if (!result) {
    questions.forEach((question) => {
      if (question.answers) {
        question.answers.forEach((answer) => {
          if (answer.additionalQuestions) {
            result = findQuestionByVariable(answer.additionalQuestions, variable);
          }
        });
      }
    });
  }

  if (result && result.answerType !== 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD') {
    return result;
  } else {
    return;
  }
};

/**
 * Set value in context options;
 * Creating options.${context.Model.modelName}._instance[${context.instance.id}][${container}] object in context and store the 'value' at the 'key' position
 * @param context
 * @param key
 * @param value
 * @param [container]
 */
const setValueInContextOptions = function (context, key, value, container = '_data') {
  _.set(context, `options.${context.Model.modelName}._instance[${context.instance ? context.instance.id : context.currentInstance.id}][${container}][${key}]`, value);
};

/**
 * Get value from context options for the key
 * Retrieving options.${context.Model.modelName}._instance[${context.instance.id}][$contaner][${key}] from context
 * Returning null if not found
 * @param context
 * @param key
 * @param [container]
 */
const getValueFromContextOptions = function (context, key, container = '_data') {
  return _.get(context, `options.${context.Model.modelName}._instance[${context.instance ? context.instance.id : context.currentInstance.id}][${container}][${key}]`, null);
};

/**
 * Set original value in context options;
 * Creating options.${context.Model.modelName}._instance[${context.instance.id}]._original object in context and store the 'value' at the 'key' position
 * @param context
 * @param key
 * @param value
 */
const setOriginalValueInContextOptions = function (context, key, value) {
  setValueInContextOptions(context, key, value, '_original');
};

/**
 * Get original value from context options for the key
 * Retrieving options.${context.Model.modelName}._instance[${context.instance.id}]._original[${key}] from context
 * Returning null if not found
 * @param context
 * @param key
 */
const getOriginalValueFromContextOptions = function (context, key) {
  return getValueFromContextOptions(context, key, '_original');
};

/**
 * Paginate a result set that does not support native pagination
 * @param filter
 * @param resultSet
 * @return {*}
 */
const paginateResultSet = function (filter, resultSet) {
  // get offset
  const skip = _.get(filter, 'skip', 0);
  // get limit
  let limit = _.get(filter, 'limit');
  // if there's a limit
  if (limit != null) {
    // add the offset to the limit (Array.slice uses start + end position)
    limit = skip + limit;
  }
  // if any of the filters are defined
  if (skip || limit) {
    // paginate result set
    resultSet = resultSet.slice(skip, limit);
  }
  return resultSet;
};

/**
 * Get a period interval of period type for date
 * @param fullPeriodInterval period interval limits (max start date/max end date)
 * @param periodType enum: ['day', 'week', 'month']
 * @param date
 * @return {['startDate', 'endDate']}
 */
const getPeriodIntervalForDate = function (fullPeriodInterval, periodType, date) {
  // get period in which the case needs to be included
  let periodInterval, beginningOfDay, endOfDay, mondayStartOfDay, sundayEndOfDay, firstDayOfMonth, lastDayOfMonth;

  switch (periodType) {
    case 'day':
      // get day interval for date
      beginningOfDay = getDate(date).toString();
      endOfDay = getDateEndOfDay(date).toString();
      periodInterval = [beginningOfDay, endOfDay];
      break;
    case 'week':
      // get week interval for date
      mondayStartOfDay = getDate(date, 1);
      sundayEndOfDay = getDateEndOfDay(date, 7);
      // we should use monday only if it is later than the first date of the fullPeriodInterval; else use the first date of the period interval
      mondayStartOfDay = (mondayStartOfDay.isAfter(fullPeriodInterval[0]) ? mondayStartOfDay : getDate(fullPeriodInterval[0])).toString();
      // we should use sunday only if it is earlier than the last date of the fullPeriodInterval; else use the last date of the period interval
      sundayEndOfDay = (sundayEndOfDay.isBefore(fullPeriodInterval[1]) ? sundayEndOfDay : getDateEndOfDay(fullPeriodInterval[1])).toString();
      periodInterval = [mondayStartOfDay, sundayEndOfDay];
      break;
    case 'month':
      // get month period interval for date
      firstDayOfMonth = getDate(date).startOf('month');
      lastDayOfMonth = getDateEndOfDay(date).endOf('month');
      // we should use first day of month only if it is later than the first date of the fullPeriodInterval; else use the first date of the period interval
      firstDayOfMonth = (firstDayOfMonth.isAfter(fullPeriodInterval[0]) ? firstDayOfMonth : getDate(fullPeriodInterval[0])).toString();
      // we should use last day of month only if it is earlier than the last date of the fullPeriodInterval; else use the last date of the period interval
      lastDayOfMonth = (lastDayOfMonth.isBefore(fullPeriodInterval[1]) ? lastDayOfMonth : getDateEndOfDay(fullPeriodInterval[1])).toString();
      periodInterval = [firstDayOfMonth, lastDayOfMonth];
      break;
  }
  // return period interval
  return periodInterval;
};

/**
 * Create a PDF file containing PNG images
 * @param imageData
 * @param splitFactor Split the image into:
 * - a nxm matrix computed based on the provided image size
 * - a square matrix with a side of <splitFactor> (1 no split, 2 => 2x2 grid, 3 => 3x3 grid) when splitType is grid
 * - a list of <splitFactor> images, divided horizontally when splitType is horizontal
 * - a list of <splitFactor> images, divided vertically when splitType is vertical
 * @param splitType enum: ['auto', grid', 'horizontal', 'vertical']. Default 'auto'.
 * @param callback
 */
const createImageDoc = workerRunner.helpers.createImageDoc;


/**
 * Hexadecimal Sha256 hash
 * @param string
 * @return {string}
 */
function sha256(string) {
  return crypto.createHash('sha256').update(string).digest('hex');
}

function convertToDate(date) {
  return moment(date).startOf('day');
}

/**
 * Migrate data in batches
 * @param Model
 * @param modelHandleCallback
 * @returns {Promise<any>}
 */
function migrateModelDataInBatches(
  Model,
  modelHandleCallback
) {
  return new Promise((resolve, reject) => {
    // determine how many case we have so we can update them in batches
    Model
      .count({
        $or: [
          {
            deleted: false
          },
          {
            deleted: {
              $eq: null
            }
          },
          {
            deleted: true
          }
        ]
      })
      .catch(reject)
      .then((countedModels) => {
        // make changes in batches
        // retrieve batches until all are retrieve
        let handledNo = 0;
        const handledPerBatch = 1000;
        const handleBatch = () => {
          Model
            .find({
              deleted: true,
              skip: handledNo,
              limit: handledPerBatch
            })
            .catch(reject)
            .then((models) => {
              // create jobs to handle date in parallel
              const jobs = [];
              models.forEach((modelData) => {
                jobs.push((cb) => {
                  modelHandleCallback(modelData, cb);
                });
              });

              // wait for all operations to be done
              async.parallelLimit(
                jobs,
                10,
                (err) => {
                  // an err occurred ?
                  if (err) {
                    reject(err);
                  }

                  // there are more batches ?
                  handledNo = handledNo + handledPerBatch;
                  if (handledNo < countedModels) {
                    handleBatch();
                  } else {
                    // finished
                    resolve();
                  }
                }
              );
            });
        };

        // start
        if (handledNo < countedModels) {
          handleBatch();
        } else {
          // finished
          resolve();
        }
      });
  });
}

/**
 * Check for address/addresses properties and if GeoPoint is found convert it to Loopback format
 * Note: This function affect the received model instance
 * Converts {
 *   coordinates: [number, number],
 *   type: "Point"
 * } to {
 *   lat: number,
 *   lng: number
 * }
 * @param modelInstance
 */
function covertAddressesGeoPointToLoopbackFormat(modelInstance = {}) {
  // check if modelInstance has address/addresses; nothing to do in case an address is not set
  if (!modelInstance.address && !modelInstance.addresses) {
    return;
  }

  // always works with same data type (simplify logic)
  let addressesToUpdate;
  if (modelInstance.address) {
    addressesToUpdate = [modelInstance.address];
  } else {
    addressesToUpdate = modelInstance.addresses;
  }

  // loop through the addresses and update then if needed
  addressesToUpdate.forEach(function (address) {
    // if the GeoPoint exists and is not in the desired format
    if (address.geoLocation &&
      typeof address.geoLocation === 'object' &&
      address.geoLocation.coordinates &&
      address.geoLocation.lng === undefined &&
      address.geoLocation.lat === undefined) {
      // convert it
      _.set(address, 'geoLocation', {
        lat: address.geoLocation.coordinates[1],
        lng: address.geoLocation.coordinates[0]
      });
    }
  });
}

/**
 * Sort multi answer questionnaire answers by date
 * @param model
 */
const sortMultiAnswerQuestions = function (model) {
  if (
    model &&
    _.isObject(model.questionnaireAnswers)
  ) {
    // shorthand reference
    const answers = model.questionnaireAnswers;
    for (let prop in answers) {
      if (
        Array.isArray(answers[prop]) &&
        answers[prop].length
      ) {
        // sort them by date
        answers[prop] = answers[prop].sort((a, b) => moment(b.date).format('X') - moment(a.date).format('X'));
      }
    }
  }
};

/**
 * Convert questionnaire answers from new format ([ { date: Date, value: Question answer } ]) to old
 * @param answer
 */
const convertQuestionAnswerToOldFormat = function (answer) {
  if (Array.isArray(answer) && answer.length) {
    // doing this to take the latest answer for multi day answers
    return answer.slice(0, 1)[0].value;
  }
  return answer;
};

/**
 * Convert questionnaire answers from new format ([ { date: Date, value: Question answer } ]) to value
 * @param answers
 */
const convertQuestionnaireAnswersToOldFormat = function (answers) {
  const result = {};
  for (let qVar in answers) {
    result[qVar] = convertQuestionAnswerToOldFormat(answers[qVar]);
  }
  return result;
};

module.exports = {
  getDate: getDate,
  streamToBuffer: streamUtils.streamToBuffer,
  remapProperties: remapProperties,
  getDateEndOfDay: getDateEndOfDay,
  getAsciiString: getAsciiString,
  getChunksForInterval: getChunksForInterval,
  convertPropsToDate: convertPropsToDate,
  isValidDate: isValidDate,
  extractImportableFields: extractImportableFields,
  exportListFile: exportListFile,
  exportListFileSync: exportListFileSync,
  getReferencedValue: getReferencedValue,
  resolveModelForeignKeys: resolveModelForeignKeys,
  getFlatObject: getFlatObject,
  getDateDisplayValue: getDateDisplayValue,
  parseModelFieldValues: parseModelFieldValues,
  isPathOK: isPathOK,
  formatDateFields: formatDateFields,
  formatUndefinedValues: formatUndefinedValues,
  translateDataSetReferenceDataValues: translateDataSetReferenceDataValues,
  translateFieldLabels: translateFieldLabels,
  includeSubLocationsInLocationFilter: includeSubLocationsInLocationFilter,
  translateQuestionnaire: translateQuestionnaire,
  translateQuestionAnswers: translateQuestionAnswers,
  getBuildInformation: getBuildInformation,
  convertBooleanProperties: convertBooleanProperties,
  getSourceAndTargetFromModelHookContext: getSourceAndTargetFromModelHookContext,
  addQuestionnaireHeadersForPrint: spreadSheetFile.addQuestionnaireHeadersForPrint,
  setOriginalValueInContextOptions: setOriginalValueInContextOptions,
  getOriginalValueFromContextOptions: getOriginalValueFromContextOptions,
  paginateResultSet: paginateResultSet,
  setValueInContextOptions: setValueInContextOptions,
  getValueFromContextOptions: getValueFromContextOptions,
  getPeriodIntervalForDate: getPeriodIntervalForDate,
  sha256: sha256,
  createImageDoc: createImageDoc,
  convertToDate: convertToDate,
  migrateModelDataInBatches: migrateModelDataInBatches,
  covertAddressesGeoPointToLoopbackFormat: covertAddressesGeoPointToLoopbackFormat,
  sortMultiAnswerQuestions: sortMultiAnswerQuestions,
  convertQuestionAnswerToOldFormat: convertQuestionAnswerToOldFormat,
  convertQuestionnaireAnswersToOldFormat: convertQuestionnaireAnswersToOldFormat
};
