'use strict';

module.exports = {};

// dependencies
const localizationHelper = require('./localizationHelper');
const _ = require('lodash');
const apiError = require('./apiError');
const spreadSheetFile = require('./spreadSheetFile');
const pdfDoc = require('./pdfDoc');
const streamUtils = require('./streamUtils');
const async = require('async');
const fs = require('fs');
const packageJson = require('../package');
const workerRunner = require('./workerRunner');
const crypto = require('crypto');
const EpiWeek = require('epi-week');
const config = require('../server/config');
const {performance} = require('perf_hooks');
const randomize = require('randomatic');

const DATA_TYPE = {
  BOOLEAN: 'Boolean',
  DATE: 'Date'
};

// default language - in case we don't have user language
// - or if user language token translations are missing then they are replaced by default language tokens which should have all tokens...
const DEFAULT_LANGUAGE = 'english_us';

// default system admin user id
const DEFAULT_SYSTEM_ADMIN_ID = 'sys_admin';

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
 * Calculate end of week for different type of weeks
 * @param date
 * @param weekType ISO, Sunday Starting, CDC (EPI WEEK)
 */
const calculateEndOfWeek = function (date, weekType) {
  weekType = weekType || 'iso';
  let result = null;
  switch (weekType) {
    case 'iso':
      result = date.clone().endOf('isoWeek');
      break;
    case 'sunday':
      result = date.clone().endOf('week');
      break;
    case 'epi':
      const epiWeek = EpiWeek(date.clone().toDate());
      result = date.clone().week(epiWeek.week).endOf('week');
      break;
  }
  return result;
};

/**
 * Split a date interval into chunks of specified length
 * @param start Interval start date
 * @param end Interval end date
 * @param chunkType String Length of each resulted chunk; Can be a (day, week, month)
 * @param weekType Type of week (epi, iso, sunday)
 */
const getDateChunks = function (start, end, chunkType, weekType) {
  start = localizationHelper.getDateStartOfDay(start);
  end = localizationHelper.getDateEndOfDay(end);
  let result = [];
  switch (chunkType) {
    case 'day':
      let range = localizationHelper.getRange(start, end);
      result = Array.from(range.by('day')).map(day => ({start: localizationHelper.getDateStartOfDay(day), end: localizationHelper.getDateEndOfDay(day)}));
      break;
    case 'week':
    case 'month':
      let date = start.clone();
      while (date.isBefore(end)) {
        if (!date.isSame(start)) {
          date.add(1, 'day');
        }
        let lastDate = chunkType === 'week' ? calculateEndOfWeek(date, weekType) : date.clone().endOf(chunkType);
        if (lastDate.isSameOrAfter(end)) {
          lastDate = end;
        }
        result.push({
          start: localizationHelper.getDateStartOfDay(date.clone()),
          end: lastDate.clone()
        });
        date = lastDate;
      }
      break;
  }
  return result;
};

/**
 * Split a date interval into chunks of specified length
 * @param interval Array containing the margin dates of the interval
 * @param chunk String Length of each resulted chunk; Can be a daily/weekly/monthly
 * @param weekType Type of week (epi, iso, sunday)
 * @returns {{}} Map of chunks
 */
const getChunksForInterval = function (interval, chunk, weekType) {
  // initialize map of chunk values
  let chunkMap = {
    day: 'day',
    week: 'week',
    month: 'month'
  };
  // set default chunk to 1 day
  chunk = chunk ? chunkMap[chunk] : chunkMap.day;

  // make sure we're always dealing with moment dates
  interval[0] = localizationHelper.getDateStartOfDay(interval[0]);
  interval[1] = localizationHelper.getDateEndOfDay(interval[1]);

  // get chunks
  let chunks = getDateChunks(interval[0], interval[1], chunk, weekType);

  // initialize result
  let result = {};

  // parse the chunks and create map with UTC dates
  chunks.forEach(chunk => {
    // create period identifier
    let identifier = chunk.start.toString() + ' - ' + chunk.end.toString();

    // store period entry in the map
    result[identifier] = {
      start: chunk.start,
      end: chunk.end
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
 * @param dontRemoveEmptyData
 * @return {Array}
 */
function remapPropertiesUsingProcessedMap(
  dataSet,
  processedMap,
  valuesMap,
  parentPath = '',
  dontRemoveEmptyData = false
) {
  // remove empty object since these aren't relevant
  // clean array ( remove empty objects... )
  const removeEmptyObjectsAndArrays = (data) => {
    // check if there is a point in doing something here
    if (_.isArray(data)) {
      // construct a new array with only valid objects
      const newArray = [];
      data.forEach((value) => {
        // clean objects
        const isObjectOrArray = _.isArray(value) || _.isObject(value);
        if (isObjectOrArray) {
          // clean object / arrays
          value = removeEmptyObjectsAndArrays(value);

          // check if we need to remove item from array
          if (!_.isEmpty(value)) {
            newArray.push(value);
          }
        } else if (
          // remove unnecessary empty values from arrays
          // - the only place where we need empty values is when we have questionnaires with multi answers, but that should be handled by having objects with {date: '..', value: undefined }
          value !== undefined &&
          value !== null
        ) {
          newArray.push(value);
        }

        // replace old array with the new one
        data = newArray;
      });
    } else if (_.isObject(data)) {
      _.each(
        data,
        (value, property) => {
          if (value === undefined) {
            delete data[property];
          } else if (_.isArray(value)) {
            data[property] = removeEmptyObjectsAndArrays(value);
          } else if (_.isObject(value)) {
            value = removeEmptyObjectsAndArrays(value);
            if (_.isEmpty(value)) {
              delete data[property];
            } else {
              data[property] = value;
            }
          }
        }
      );
    }

    // finished
    return data;
  };

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
                `${parentPathPrefix}${sourcePath}[]`,
                // no need to remove empty data, since we will do that recursively at the parent level
                true
              )
            );
            // simple mapping, no arrays
          } else {
            // get the resolved value
            const value = _.get(item, sourcePath);

            // define function that will handle recursive map
            const mapValues = (localValue, addToArray) => {
              // get source path
              let actualMapPath = processedMap.map[sourcePath];
              const isBasicArray = processedMap.map[sourcePath].includes('_____A');
              if (isBasicArray) {
                actualMapPath = actualMapPath.replace('_____A', '');
              }

              // initialize array if necessary
              const getArray = (mapPath) => {
                // push array
                let dataArray = _.get(result, mapPath);
                if (!dataArray) {
                  dataArray = [];
                  _.set(result, mapPath, dataArray);
                }
                return dataArray;
              };

              // define a replacement parent value
              let replaceValueParent;

              // check if the value has a replacement value defined
              if (
                localValue !== undefined &&
                typeof localValue !== 'object' &&
                valuesMap &&
                // strip indices for values map, we're only interested in the generic path not the exact one
                (replaceValueParent = valuesMap[`${parentPathPrefix.replace(/\[\d+]/g, '[]')}${sourcePath.replace(/\[\d+]/g, '[]')}`])
                && replaceValueParent[localValue] !== undefined
              ) {
                // use that replacement value
                if (
                  addToArray ||
                  isBasicArray
                ) {
                  getArray(actualMapPath).push(replaceValueParent[localValue]);
                } else {
                  _.set(result, actualMapPath, replaceValueParent[localValue]);
                }
              } else {
                // if array we need to check values since we might have an array of mapped values
                if (_.isArray(localValue)) {
                  // go through each value and check if we can map it
                  localValue.forEach((deepValue) => {
                    mapValues(deepValue, true);
                  });
                } else {
                  // no replacement value defined, use resolved value
                  if (
                    addToArray ||
                    isBasicArray
                  ) {
                    // we don't push undefined values
                    if (localValue !== undefined) {
                      getArray(actualMapPath).push(localValue);
                    }
                  } else {
                    _.set(result, actualMapPath, localValue);
                  }
                }
              }
            };

            // check if the value has a replacement value defined
            mapValues(value);
          }
        });
        // store the result
        results.push(dontRemoveEmptyData ? result : removeEmptyObjectsAndArrays(result));
      } else {
        // nothing to process, copy as is
        results.push(dontRemoveEmptyData ? item : removeEmptyObjectsAndArrays(item));
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
      } else if (importableProperty.indexOf('.') > -1) {
        // property is object path ?
        const importValue = _.get(data, importableProperty);
        if (importValue !== undefined) {
          _.set(
            importableFields,
            importableProperty,
            importValue
          );
        }
      }
    });
  }
  return importableFields;
};

/**
 * TODO: Duplicated functionality from above without using Loopback models
 * Extract only the importable fields for a model from a record data
 * @param {Array} modelImportableTopLevelProperties
 * @param {Object} data
 */
const extractImportableFieldsNoModel = function (modelImportableTopLevelProperties, data) {
  // store importable properties as part of a new object
  const importableFields = {};
  // nothing to do if there is no data
  if (data) {
    // go through all importable top level properties
    modelImportableTopLevelProperties.forEach(function (importableProperty) {
      // add the importable data (if it exists)
      if (data[importableProperty] !== undefined) {
        importableFields[importableProperty] = data[importableProperty];
      } else if (importableProperty.indexOf('.') > -1) {
        // property is object path ?
        const importValue = _.get(data, importableProperty);
        if (importValue !== undefined) {
          _.set(
            importableFields,
            importableProperty,
            importValue
          );
        }
      }
    });
  }
  return importableFields;
};

/**
 * Export a list in a file (synchronously)
 * @param headers file list headers
 * @param dataSet {Array} actual data set
 * @param fileType {enum} [json, csv, xls, xlsx, ods, pdf]
 * @return {Promise<any>}
 */
const exportListFileSync = function (headers, dataSet, fileType, title = 'List') {

  /**
   * Build headers map in a way compatible with files that support hierarchical structures (JSON)
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
          result[headersMap[header]] = localizationHelper.getDateDisplayValue(source[header]);
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

    let headersMap, remappedDataSet;
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
        reject(apiError.getError('REQUEST_VALIDATION_ERROR', {errorMessages: `Invalid Export Type: ${fileType}. Supported options: json, csv, xls, xlsx, ods, pdf`}));
        break;
    }
  });
};

/**
 * Export a list in a file (asynchronously)
 * @param headers file list headers
 * @param dataSet {Array} actual data set
 * @param fileType {enum} [json, csv, xls, xlsx, ods, pdf]
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
    let dataFromPath = _.get(data, arrayPath, []);
    dataFromPath = dataFromPath ? dataFromPath : [];
    if (Array.isArray(dataFromPath)) {
      dataFromPath.forEach(function (dataItem, index) {
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
      // path specifies that the value should be an array but retrieved value is not
      // might happen for anonymized fields
      result = {
        value: dataFromPath,
        exactPath: arrayPath
      };
    }
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
        translateDataSetReferenceDataValues(result, Model.referenceDataFields, languageDictionary);
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
          result[propertyName] = localizationHelper.getDateDisplayValue(object[property]);
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
    if (reference.value === '***') {
      // don't format anonymized date
      return;
    } else if (Array.isArray(reference)) {
      reference.forEach((indicator) => {
        if (indicator.value === '***') {
          // don't format anonymized date
          return;
        }

        _.set(model, indicator.exactPath, localizationHelper.formatDate(indicator.value));
      });
    } else {
      _.set(model, reference.exactPath, localizationHelper.formatDate(reference.value));
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
 * @param referenceDataFields
 * @param dictionary
 */
const translateDataSetReferenceDataValues = function (dataSet, referenceDataFields, dictionary) {
  if (referenceDataFields) {
    if (!Array.isArray(dataSet)) {
      dataSet = [dataSet];
    }

    dataSet.forEach((model) => {
      referenceDataFields.forEach((field) => {
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
 * @param includeParentLocations
 */
const translateFieldLabels = function (app, model, modelName, dictionary, includeParentLocations) {
  includeParentLocations = includeParentLocations || false;

  let parentLocationsMap = {};
  let locationsFieldsMap = {};
  let fieldsToTranslate = {};

  if (!app.models[modelName]) {
    fieldsToTranslate = nonModelObjects[modelName];
  } else {
    locationsFieldsMap = app.models[modelName].locationsFieldsMap || {};
    Object.keys(locationsFieldsMap).forEach(field => {
      parentLocationsMap[`${field}_parentLocations`] = locationsFieldsMap[field];
    });

    fieldsToTranslate = Object.assign(
      app.models[modelName].fieldLabelsMap,
      app.models[modelName].relatedFieldLabelsMap
    );

    let fieldsToPick = app.models[modelName].printFieldsinOrder;
    if (includeParentLocations) {
      fieldsToPick = [].concat(fieldsToPick, Object.keys(parentLocationsMap));
    }
    model = _.pick(model, fieldsToPick);
  }

  let translatedFieldsModel = {};
  Object.keys(model).forEach(function (key) {
    let value = model[key];
    let newValue = value;
    if (fieldsToTranslate && fieldsToTranslate[key]) {
      if (Array.isArray(value) && value.length && typeof (value[0]) === 'object' && arrayFields[key]) {
        newValue = [];
        value.forEach((element, index) => {
          newValue[index] = translateFieldLabels(app, element, arrayFields[key], dictionary, includeParentLocations);
        });
      } else if (typeof (value) === 'object' && value !== null && Object.keys(value).length > 0) {
        newValue = translateFieldLabels(app, value, arrayFields[key], dictionary, includeParentLocations);
      }
      translatedFieldsModel[dictionary.getTranslation(app.models[modelName] ? fieldsToTranslate[key] : nonModelObjects[modelName][key])] = newValue;
      if (includeParentLocations && locationsFieldsMap[key]) {
        const parentLocationKey = `${key}_parentLocations`;
        (model[parentLocationKey] || []).forEach((location, index) => {
          const keyTranslation = dictionary.getTranslation(parentLocationsMap[parentLocationKey]);
          const geoLevelTranslation = dictionary.getTranslation('LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL');
          const field = `${keyTranslation} ${geoLevelTranslation} ${index}`;
          translatedFieldsModel[field] = location;
        });
        delete model[parentLocationKey];
      }
    } else {
      if (!parentLocationsMap[key] || !includeParentLocations) {
        translatedFieldsModel[key] = value;
      }
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
const includeSubLocationsInLocationFilter = function (
  app,
  filter,
  locationKey,
  callback
) {
  // build a list of search actions
  const searchForLocations = [];
  // go through all filter properties
  Object.keys(filter).forEach(function (propertyName) {
    // search for the parentLocationIdFilter
    if (propertyName.includes('parentLocationIdFilter')) {
      // start with no location filter
      let parentLocationFilter;
      let inqKey = 'inq';
      // handle string type
      if (typeof filter[propertyName] === 'string') {
        parentLocationFilter = [filter[propertyName]];
        // handle include type
      } else if (filter[propertyName] && typeof filter[propertyName] === 'object' && Array.isArray(filter[propertyName].inq)) {
        parentLocationFilter = filter[propertyName].inq;
      } else if (filter[propertyName] && typeof filter[propertyName] === 'object' && Array.isArray(filter[propertyName].$in)) {
        parentLocationFilter = filter[propertyName].$in;
        inqKey = '$in';
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
              const customLocationFilters = [
                'usualPlaceOfResidenceLocationId',
                'deathLocationId',
                'burialLocationId',
                'locationIds'
              ];
              let propertyReplaced = false;
              customLocationFilters.forEach((customLocationField) => {
                if (propertyName === `${customLocationField}.parentLocationIdFilter`) {
                  // replace
                  filter[customLocationField] = {
                    [inqKey]: locationIds
                  };

                  // handled
                  propertyReplaced = true;
                }
              });

              // already handled ?
              if (!propertyReplaced) {
                filter[propertyName.replace('parentLocationIdFilter', locationKey)] = {
                  [inqKey]: locationIds
                };
              }

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
            includeSubLocationsInLocationFilter(app, item, locationKey, callback);
          });
        }
      });
    } else if (filter[propertyName] && typeof filter[propertyName] === 'object') {
      // if the element is an object
      searchForLocations.push(function (callback) {
        // process it recursively
        includeSubLocationsInLocationFilter(app, filter[propertyName], locationKey, callback);
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
    version: _.get(packageJson, 'build.version', _.get(packageJson, 'version')),
    build: _.get(packageJson, 'build.build', 'development'),
    arch: _.get(packageJson, 'build.arch', 'x64')
  };
};

/**
 * Gets the "date" properties of the questionnaire
 */
const getQuestionnaireDateProperties = (questionnaireDateProperties, questions) => {
  // parse all questions
  if (questions) {
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
      // get question
      const question = questions[questionIndex];

      // is multiple answer ?
      if (question.multiAnswer) {
        questionnaireDateProperties.push(`questionnaireAnswers.${question.variable}[].date`);
      }

      // is "date" type ?
      if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_DATE_TIME') {
        questionnaireDateProperties.push(`questionnaireAnswers.${question.variable}[].value`);
      }

      // check if there are additional questions
      if (
        question.answers &&
        question.answers.length
      ) {
        for (let answerIndex = 0; answerIndex < question.answers.length; answerIndex++) {
          // get answer
          const answer = question.answers[answerIndex];

          // go through all sub questions
          if (
            answer.additionalQuestions &&
            answer.additionalQuestions.length
          ) {
            getQuestionnaireDateProperties(questionnaireDateProperties, answer.additionalQuestions);
          }
        }
      }
    }
  }
};

/**
 * Check Model definition for properties by data type and get their references
 * Also checks for nested definitions
 * @param model Model definition
 * @param dataType Data Type (boolean/date)
 * @param prefix Prefix to be attached to properties when the model is nested; Must have the '.' suffix
 * @returns {[]}
 */
const getModelPropertiesByDataType = function (model, dataType, prefix = '') {
  // used in getReferencedValue function
  const arrayIdentifier = '[].';

  let result = [];

  if (
    !model ||
    typeof model !== 'function' ||
    !model.forEachProperty) {
    // not a loopback model
    return result;
  }

  // go through all model properties, from model definition
  model.forEachProperty(function (propertyName) {
    // check if the property is supposed to be the input data type
    if (model.definition.properties[propertyName].type) {
      // check for simple prop
      if (model.definition.properties[propertyName].type.name === dataType) {
        // store property name
        result.push(prefix + propertyName);
      }
      // check for model definition
      // eg: address: "address"
      else if (typeof model.definition.properties[propertyName].type === 'function') {
        result = result.concat(
          getModelPropertiesByDataType(
            model.definition.properties[propertyName].type,
            dataType,
            propertyName + '.')
        );
      }
      // check for array of model definitions
      // eg: persons: ["relationshipParticipant"]
      else if (
        Array.isArray(model.definition.properties[propertyName].type) &&
        typeof model.definition.properties[propertyName].type[0] === 'function'
      ) {
        result = result.concat(
          getModelPropertiesByDataType(
            model.definition.properties[propertyName].type[0],
            dataType,
            propertyName + arrayIdentifier
          )
        );
      }
    }
  });

  return result;
};

/**
  * Convert model properties to correct type values from strings/number
 * @param {Array} modelProperties
 * @param dataType Data Type (boolean/date)
 * @param {Object|Array} dataSet
 */
const convertPropertiesNoModelByType = function (modelProperties, dataSet, dataType) {
  /**
   * Set property boolean/date value on a record given its reference
   * Also accepts array references
   * @param record Record to be updated
   * @param propRef Property reference
   */
  const setValueOnRecordProperty = function (record, propRef, dataType) {
    let propRefValues = getReferencedValue(record, propRef);
    // if it's single value, convert it to array (simplify the code)
    if (!Array.isArray(propRefValues)) {
      propRefValues = [propRefValues];
    }
    // go through all the found values
    propRefValues.forEach(refValue => {
      if (refValue.value != null) {
        // convert data value that doesn't match the data type
        switch (dataType) {
          case DATA_TYPE.BOOLEAN:
            if ((typeof refValue.value).toLowerCase() !== 'boolean') {
              _.set(record, refValue.exactPath, ['1', 'true'].includes(refValue.value.toString().toLowerCase()));
            }

            break;
          case DATA_TYPE.DATE:
            // if value is a number convert it into JavaScript date
            if (!isNaN(Number(refValue.value))) {
              _.set(record, refValue.exactPath, localizationHelper.excelDateToJSDate(refValue.value));
            }

            break;
        }
      }
    });
  };

  /**
   * Convert model properties by data type for a single record instance
   * @param dataType Data Type (boolean/date)
   * @param record
   */
  function convertModelPropertiesByDataType(record, dataType) {
    // check each property that is supposed to be received type
    modelProperties.forEach(function (property) {
      setValueOnRecordProperty(record, property, dataType);
    });
  }

  // array of records
  if (Array.isArray(dataSet)) {
    // go through the dataSet records
    dataSet.forEach(function (record) {
      // convert each record
      convertModelPropertiesByDataType(record, dataType);
    });
    // single record
  } else {
    // convert record
    convertModelPropertiesByDataType(dataSet, dataType);
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
 * Set value in options;
 */
const setValueInOptions = function (
  options,
  modelName,
  id,
  key,
  value,
  container = '_data'
) {
  _.set(options, `${modelName}._instance[${id}][${container}][${key}]`, value);
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
  context.options = context.options || {};
  setValueInOptions(
    context.options,
    context.Model.modelName,
    context.instance ?
      context.instance.id :
      context.currentInstance.id,
    key,
    value,
    container
  );
};

/**
 * Get value from options for the key
 */
const getValueFromOptions = function (
  options,
  modelName,
  id,
  key,
  container = '_data'
) {
  return _.get(options, `${modelName}._instance[${id}][${container}][${key}]`, null);
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
  context.options = context.options || {};
  return getValueFromOptions(
    context.options,
    context.Model.modelName,
    context.instance ?
      context.instance.id :
      context.currentInstance.id,
    key,
    container
  );
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
 * @param weekType iso / sunday / epi (default: iso)
 * @return {['startDate', 'endDate']}
 */
const getPeriodIntervalForDate = function (
  fullPeriodInterval,
  periodType,
  date,
  weekType
) {
  // make sure dates are in interval limits
  if (
    fullPeriodInterval &&
    fullPeriodInterval.length > 1
  ) {
    date = localizationHelper.getDateStartOfDay(date).isAfter(fullPeriodInterval[0]) ? date : localizationHelper.getDateStartOfDay(fullPeriodInterval[0]);
    date = localizationHelper.getDateStartOfDay(date).isBefore(fullPeriodInterval[1]) ? date : localizationHelper.getDateEndOfDay(fullPeriodInterval[1]);
  }

  // get period in which the case needs to be included
  let startDay, endDay;
  switch (periodType) {
    case 'day':
      // get day interval for date
      startDay = localizationHelper.getDateStartOfDay(date);
      endDay = localizationHelper.getDateEndOfDay(date);
      break;
    case 'week':
      // get week interval for date
      weekType = weekType || 'iso';
      switch (weekType) {
        case 'iso':
          startDay = localizationHelper.getDateStartOfDay(date).startOf('isoWeek');
          endDay = localizationHelper.getDateEndOfDay(date).endOf('isoWeek');
          break;
        case 'sunday':
          startDay = localizationHelper.getDateStartOfDay(date).startOf('week');
          endDay = localizationHelper.getDateEndOfDay(date).endOf('week');
          break;
        case 'epi':
          date = localizationHelper.getDateStartOfDay(date);
          const epiWeek = EpiWeek(date.clone().toDate());
          startDay = date.clone().week(epiWeek.week).startOf('week');
          endDay = date.clone().week(epiWeek.week).endOf('week');
          break;
      }

      break;
    case 'month':
      // get month period interval for date
      startDay = localizationHelper.getDateStartOfDay(date).startOf('month');
      endDay = localizationHelper.getDateEndOfDay(date).endOf('month');
      break;
  }

  // make sure dates are in interval limits
  if (
    fullPeriodInterval &&
    fullPeriodInterval.length > 1
  ) {
    startDay = startDay.isAfter(fullPeriodInterval[0]) ? startDay : localizationHelper.getDateStartOfDay(fullPeriodInterval[0]);
    endDay = endDay.isBefore(fullPeriodInterval[1]) ? endDay : localizationHelper.getDateEndOfDay(fullPeriodInterval[1]);
    endDay = endDay.isAfter(startDay) ? endDay : localizationHelper.getDateEndOfDay(startDay);
  }

  // return period interval
  return [startDay.toString(), endDay.toString()];
};

/**
 * Hexadecimal Sha256 hash
 * @param string
 * @return {string}
 */
function sha256(string) {
  return crypto.createHash('sha256').update(string).digest('hex');
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
            })
            .catch(reject);
        };

        // start
        if (handledNo < countedModels) {
          handleBatch();
        } else {
          // finished
          resolve();
        }
      })
      .catch(reject);
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
 * @param {string} customModelAddressField - custom path for address field
 */
function covertAddressesGeoPointToLoopbackFormat(modelInstance = {}, customModelAddressField) {
  // check if modelInstance has address/addresses; nothing to do in case an address is not set
  if (
    !modelInstance.address &&
    !modelInstance.addresses &&
    !modelInstance.fillLocation &&
    !modelInstance.geoLocation &&
    (
      !customModelAddressField ||
      !_.get(modelInstance, customModelAddressField)
    )
  ) {
    return;
  }

  // always works with same data type (simplify logic)
  let addressesToUpdate;
  if (modelInstance.address) {
    addressesToUpdate = [modelInstance.address];
  } else {
    addressesToUpdate = modelInstance.addresses ?
      modelInstance.addresses :
      [];
  }

  // do we need to convert fill location two ?
  // make sure we don't alter the original array
  if (!_.isEmpty(modelInstance.fillLocation)) {
    addressesToUpdate = [
      ...addressesToUpdate,
      modelInstance.fillLocation
    ];
  }

  // do we need to convert geoLocation ?
  if (!_.isEmpty(modelInstance.geoLocation)) {
    addressesToUpdate = [
      ...addressesToUpdate,
      modelInstance
    ];
  }

  // check for customModelAddressField
  if (
    customModelAddressField &&
    _.get(modelInstance, customModelAddressField)
  ) {
    if (addressesToUpdate) {
      addressesToUpdate = [
        ...addressesToUpdate,
        _.get(modelInstance, customModelAddressField)
      ];
    } else {
      addressesToUpdate = [
        _.get(modelInstance, customModelAddressField)
      ];
    }
  }

  // loop through the addresses and update then if needed
  addressesToUpdate.forEach(function (address) {
    // if the GeoPoint exists and is not in the desired format
    if (
      address.geoLocation &&
      typeof address.geoLocation === 'object' &&
      address.geoLocation.coordinates &&
      (
        address.geoLocation.lng === undefined ||
        address.geoLocation.lng === null
      ) &&
      (
        address.geoLocation.lat === undefined ||
        address.geoLocation.lat === null
      )
    ) {
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
        answers[prop] = answers[prop].sort((a, b) => localizationHelper.toMoment(b.date).format('X') - localizationHelper.toMoment(a.date).format('X'));
      }
    }
  }
};

/**
 * Convert questionnaire questions string date answers to date answers
 * @param modelChanges ( changed keys )
 * @param template ( Outbreak questionnaire template => caseInvestigationTemplate / contactFollowUpTemplate / labResultsTemplate )
 */
const convertQuestionStringDatesToDates = function (
  modelChanges,
  template
) {
  // the proper way to do it is to retrieve the outbreak template and to map dates accordingly to questionnaire template
  // but since in other place we don't take this is account, we will be consistent by implementing it the same way ( replace all strings that follow Date format to dates )
  return new Promise(function (resolve) {
    // nothing to do ?
    if (modelChanges.questionnaireAnswers) {
      // convert dates
      localizationHelper.convertPropsToDate(modelChanges.questionnaireAnswers);

      // do we have questionnaire template so we can check the format we're importing ?
      if (!_.isEmpty(template)) {
        // go through questionnaire template and map questions types to variables
        const mappedQuestionTypes = {};
        const mapQuestions = (questions) => {
          (questions || []).forEach((question) => {
            mappedQuestionTypes[question.variable] = question.answerType;

            // make sure we add sub-questions as well
            if (!_.isEmpty(question.answers)) {
              (question.answers || []).forEach((answer) => {
                if (!_.isEmpty(answer.additionalQuestions)) {
                  mapQuestions(answer.additionalQuestions);
                }
              });
            }
          });
        };

        // map
        mapQuestions(template);

        // convert invalid answers to proper answers accordingly to template definitions
        _.each(
          modelChanges.questionnaireAnswers,
          (answerData, questionVariable) => {
            // check if this is a type that we need to convert
            if (mappedQuestionTypes[questionVariable]) {
              // must convert to number ?
              if (mappedQuestionTypes[questionVariable] === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_NUMERIC') {
                (answerData || []).forEach((answer) => {
                  if (
                    answer.value !== undefined &&
                    answer.value !== null &&
                    typeof answer.value !== 'number'
                  ) {
                    try {
                      answer.value = parseFloat(answer.value);
                    } catch (e) {
                      answer.value = null;
                    }
                  }
                });
              }

              // must convert to date ?
              // handled partially above by calling convertPropsToDate
              // for now there is no need to over-complicate things
            }
          }
        );
      }
    }

    // finished
    resolve();
  });
};

/**
 * Convert questionnaire answers from new format ([ { date: Date, value: Question answer } ]) to old
 * @param answer
 */
const convertQuestionAnswerToOldFormat = function (answer) {
  if (
    Array.isArray(answer)
    && answer.length > 0 &&
    typeof answer[0] === 'object'
  ) {
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

/**
 * Convert questionnaire answers from old format to new format
 * @param answers
 */
const convertQuestionnaireAnswersToNewFormat = function (answers) {
  const result = {};
  for (let qVar in answers) {
    if (
      !answers[qVar] ||
      !_.isArray(answers[qVar]) || (
        answers[qVar].length > 0 &&
        !_.isObject(answers[qVar][0])
      )
    ) {
      result[qVar] = [{
        value: answers[qVar]
      }];
    } else {
      result[qVar] = answers[qVar];
    }
  }
  return result;
};

const convertQuestionnairePropsToDate = function (questions) {
  const parseProp = function (prop) {
    if (prop === null || prop === 'undefined') {
      return prop;
    }
    // try to convert the string value to date, if valid, replace the old value
    if (localizationHelper.isValidDate(prop)) {
      let convertedDate = localizationHelper.getDateStartOfDay(prop);
      if (convertedDate.isValid()) {
        return convertedDate.toDate();
      }
    }
    return prop;
  };

  for (let variable in questions) {
    questions[variable] = questions[variable].map(answer => {
      if (answer.date) {
        answer.date = parseProp(answer.date);
      }
      if (Array.isArray(answer.value)) {
        const resultValues = [];
        answer.value.forEach(a => {
          if (a === null || a === undefined) {
            return false;
          }
          resultValues.push(parseProp(a));
        });
        answer.value = resultValues;
      } else {
        answer.value = parseProp(answer.value);
      }
      return answer;
    });
  }

  return questions;
};

/**
 * Retrieve a custom filter option and remove the value afterwards
 * @param filter
 * @param option
 * @returns {*}
 */
const getFilterCustomOption = function (filter, option) {
  filter = filter || {};
  filter.where = filter.where || {};
  const optionValue = filter.where[option];
  delete filter.where[option];
  return optionValue;
};

/**
 * Attach locations data (id, identifiers and parent locations) for each of the target model locations
 * @param targetModel
 * @param locationModel
 * @param records
 * @param callback
 */
const attachLocations = function (targetModel, locationModel, records, callback) {
  // location fields suffixes
  const locationUIDSuffix = '_uid';
  const locationIdentifiersSuffix = '_identifiers';
  const parentLocationsSuffix = '_parentLocations';

  // get all the location ids from all the passed records
  const allLocations = [];
  const recordsLocationsMap = {};
  for (let record of records) {
    recordsLocationsMap[record.id] = [];
    for (let field of (targetModel.locationFields || [])) {
      let values = getReferencedValue(record, field);
      if (!Array.isArray(values)) {
        values = [values];
      }
      recordsLocationsMap[record.id].push(...values.filter(v => v.value));
      for (let obj of values) {
        if (obj.value) {
          allLocations.push(obj.value);
        }
      }
    }
  }

  if (!allLocations.length) {
    return callback(null, {records});
  }

  return locationModel.getParentLocationsWithDetails(
    allLocations,
    [],
    {},
    (err, locations) => {
      if (err) {
        return callback(err);
      }

      const locationsMap = {};
      for (let location of locations) {
        locationsMap[location.id] = {
          name: location.name,
          parentLocationId: location.parentLocationId,
          geographicalLevelId: location.geographicalLevelId,
          identifiers: location.identifiers
        };
      }

      // highest number of identifiers
      // used for flat files to know the highest number of columns needed
      let highestIdentifiersChain = 0;

      // highest chain of parents
      // used for flat files to know the highest number of columns needed
      let highestParentsChain = 0;

      // go through each of records location ids
      // and build a list of each location's parents to be added into the print
      for (let record of records) {
        const recordLocationsMap = recordsLocationsMap[record.id];
        for (let obj of recordLocationsMap) {
          const parentLocations = [];
          (function traverse(locationId) {
            const locationMapDef = locationsMap[locationId];
            if (locationMapDef) {
              if (!locationMapDef.parentLocationId) {
                return null;
              }
              parentLocations.unshift(locationsMap[locationMapDef.parentLocationId].name);
              traverse(locationMapDef.parentLocationId);
            }
          })(obj.value);

          // add the actual location to the end of the parent locations chain
          if (parentLocations.length) {
            parentLocations.push(locationsMap[obj.value].name);
          }
          _.set(record, `${obj.exactPath}${parentLocationsSuffix}`, parentLocations);

          // add the location uid
          _.set(record, `${obj.exactPath}${locationUIDSuffix}`, obj.value);

          if (parentLocations.length > highestParentsChain) {
            highestParentsChain = parentLocations.length;
          }

          // add the location identifiers codes
          let identifiers = [];
          if (
            locationsMap[obj.value] &&
            locationsMap[obj.value].identifiers &&
            locationsMap[obj.value].identifiers.length
          ) {
            identifiers = locationsMap[obj.value].identifiers.map((item) => {
              return item.code;
            });
          }
          _.set(record, `${obj.exactPath}${locationIdentifiersSuffix}`, identifiers);

          // update highest number of identifiers
          if (identifiers.length > highestIdentifiersChain) {
            highestIdentifiersChain = identifiers.length;
          }
        }
      }
      return callback(null, {records, highestIdentifiersChain, highestParentsChain});
    }
  );
};

/**
 * Retrieve enabled captcha items
 * @returns {{login: boolean, forgotPassword: boolean, resetPasswordQuestions: boolean}|{}}
 */
const getCaptchaConfig = () => {
  // fill missing captcha properties
  const captchaConfig = config.captcha || {};
  if (captchaConfig.login === undefined) {
    captchaConfig.login = true;
  }
  if (captchaConfig.forgotPassword === undefined) {
    captchaConfig.forgotPassword = true;
  }
  if (captchaConfig.resetPasswordQuestions === undefined) {
    captchaConfig.resetPasswordQuestions = true;
  }

  // finished
  return captchaConfig;
};

/**
 * Handle actions in batches
 * @param getActionsCount Function returning a promise which resolves with the total number of actions
 * @param getBatchData Function returning a promise which resolves with a data array for the given batch and given batch size
 * @param batchItemsAction Action for entire batch items; Function returning a promise for the given item data
 * @param itemAction Action for each item in a batch; Function returning a promise for the given item data
 * @param batchSize Size of a batch
 * @param parallelActionsNo Number of actions to be executed in parallel in a batch
 * @param logger
 * @param startFromBatch If you want to jump over the first n batches you can specify this
 * @return {*|PromiseLike<T | never | never>|Promise<T | never | never>}
 */
const handleActionsInBatches = function (
  getActionsCount,
  getBatchData,
  batchItemsAction,
  itemAction,
  batchSize,
  parallelActionsNo,
  logger,
  startFromBatch
) {
  // convert to human readable format
  const msToTime = (duration) => {
    let milliseconds = parseInt((duration % 1000) / 100),
      seconds = Math.floor((duration / 1000) % 60),
      minutes = Math.floor((duration / (1000 * 60)) % 60),
      hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    hours = (hours < 10) ? '0' + hours : hours;
    minutes = (minutes < 10) ? '0' + minutes : minutes;
    seconds = (seconds < 10) ? '0' + seconds : seconds;

    return hours + ':' + minutes + ':' + seconds + '.' + milliseconds;
  };

  // count items
  const countStartTime = performance.now();
  return getActionsCount()
    .then(actionsCount => {
      const countEndTime = performance.now();
      if (actionsCount === 0) {
        // nothing to do
        logger.debug(`No data found for which to execute actions ( count duration: ${msToTime(countEndTime - countStartTime)})`);
        return Promise.resolve();
      }

      let totalBatchesNo = Math.ceil(actionsCount / batchSize);
      logger.debug(`Actions to be done: ${new Intl.NumberFormat().format(actionsCount)}. Batches: ${totalBatchesNo}. ( count duration: ${msToTime(countEndTime - countStartTime)})`);

      /**
       * Handle batchNo of actions
       * @param batchNo
       * @return {PromiseLike<T | never>}
       */
      const handleBatch = (batchNo) => {
        // used to determine duration of each batch
        const batchStartTime = performance.now();
        let batchGetDataEndTime, batchItemsActionEndTime;

        // log
        logger.debug(`Processing batch ${batchNo} of ${totalBatchesNo}`);

        return getBatchData(batchNo, batchSize)
          .then(dataArray => {
            // used to determine how long it took to get batch data ?
            batchGetDataEndTime = performance.now();

            // do we need to execute action for all batch data ?
            if (!batchItemsAction) {
              // used to determine how long it took to get batch data ?
              batchItemsActionEndTime = performance.now();
              return dataArray;
            }

            // execute batch group promise
            return batchItemsAction(dataArray)
              .then(() => {
                // used to determine how long it took to get batch data ?
                batchItemsActionEndTime = performance.now();

                // finished
                return dataArray;
              });
          })
          .then(dataArray => {
            /// we don't need to perform an actions on each items ?
            if (!itemAction) {
              return;
            }

            // construct array of jobs that we need to perform in parallel
            let batchJobs = dataArray.map(data => {
              return (cb) => {
                return itemAction(data)
                  .then(() => {
                    return cb();
                  })
                  .catch(cb);
              };
            });

            // execute jobs in parallel
            return new Promise((resolve, reject) => {
              async.parallelLimit(batchJobs, parallelActionsNo, (err) => {
                if (err) {
                  return reject(err);
                }

                return resolve();
              });
            });
          })
          .then(() => {
            // log
            const batchEndTime = performance.now();
            logger.debug(`Finished processing batch ${batchNo} of ${totalBatchesNo} ( total duration: ${msToTime(batchEndTime - batchStartTime)}, get data duration: ${msToTime(batchGetDataEndTime - batchStartTime)}, items action duration: ${msToTime(batchItemsActionEndTime - batchGetDataEndTime)}, item actions duration: ${msToTime(batchEndTime - batchItemsActionEndTime)} )`);

            // check if we need to handle another batch
            if (batchNo * batchSize > actionsCount) {
              logger.debug('All data has been processed');
              // finished processing
              return Promise.resolve();
            } else {
              // actions handled are less than the total number; continue with next batch
              return handleBatch(++batchNo);
            }
          });
      };

      // start batches processing
      logger.debug('Processing actions in batches');
      return handleBatch(startFromBatch ? startFromBatch : 1);
    });
};

/**
 * TODO: Duplicated from templateParser; Copied here to be used in workers without including app
 * Extract a list of variables and their answers (if any) from a template
 * @param template
 * @return {Array}
 */
function extractVariablesAndAnswerOptions(template) {
  // store a list of variables
  let variables = [];
  // template should be an array of questions
  if (Array.isArray(template)) {
    // go through all the questions
    template.forEach(function (question) {
      // start building the variable
      const variable = {
        name: question.variable,
        text: question.text,
        answerType: question.answerType
      };
      // store variable in the list of variables
      variables.push(variable);
      // if the question has predefined answers
      if (
        ['LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER',
          'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS'
        ].includes(question.answerType) &&
        Array.isArray(question.answers)
      ) {
        // store a list of variables
        variable.answers = [];
        // go through the list of answers
        question.answers.forEach(function (answer) {
          // store them
          variable.answers.push({
            label: answer.label,
            value: answer.value
          });
          // if there are additional questions inside an answer
          if (Array.isArray(answer.additionalQuestions)) {
            // parse them recursively
            variables = variables.concat(extractVariablesAndAnswerOptions(answer.additionalQuestions));
          }
        });
      }
    });
  }
  return variables;
}

/**
 * Remove empty addresses and return a filtered array of addresses if an array is provided,
 * otherwise return the provided addresses value ( null | undefined | ... )
 * @param person
 * @returns {Array | any}
 */
const sanitizePersonAddresses = function (person) {
  if (person.toJSON) {
    person = person.toJSON();
  }

  // filter out empty addresses
  if (person.addresses) {
    return _.filter(person.addresses, (address) => {
      return !!_.find(address, (propertyValue) => {
        return typeof propertyValue === 'string' ?
          !!propertyValue.trim() :
          !!propertyValue;
      });
    });
  }

  // no addresses under this person
  return person.addresses;
};

/**
 * Replace system visual ID system values
 * @param visualId
 */
const sanitizePersonVisualId = (visualId) => {
  return !visualId && visualId !== 0 ?
    visualId : (
      visualId
        .toString()
        .replace(/YYYY/g, localizationHelper.now().format('YYYY'))
        .replace(/\*/g, '')
    );
};

/**
 * Retrieve duplicate key from values
 */
const getDuplicateKey = (
  modelData,
  props
) => {
  // first & last name
  let propValues = [];

  // format values and validate them, all should contain data
  for (const prop of props) {
    // not a valid prop ?
    const propFinalValue = _.camelCase(modelData[prop]).toLowerCase();
    if (!propFinalValue) {
      return null;
    }

    // attach to list
    propValues.push(propFinalValue);
  }

  // create key
  return _.camelCase(propValues.sort().join()).toLowerCase();
};

/**
 * Attach duplicate keys for easy find
 */
const attachDuplicateKeys = (
  target,
  modelData,
  duplicateKey,
  propCombinations,
  modelDataArrayKey
) => {
  // duplicate keys parent
  target.duplicateKeys = target.duplicateKeys || _.cloneDeep(modelData.duplicateKeys) || {};

  // remove previous keys
  target.duplicateKeys[duplicateKey] = [];

  // first & last name
  for (const propCombination of propCombinations) {
    // handle as array property ?
    if (modelDataArrayKey) {
      for (const arrayItem of (modelData[modelDataArrayKey] || [])) {
        // determine key
        const duplicateKeyValue = getDuplicateKey(
          arrayItem,
          propCombination
        );

        // nothing to add ?
        if (!duplicateKeyValue) {
          continue;
        }

        // add key to index
        target.duplicateKeys[duplicateKey].push(duplicateKeyValue);
      }
    } else {
      // determine key
      const duplicateKeyValue = getDuplicateKey(
        modelData,
        propCombination
      );

      // nothing to add ?
      if (!duplicateKeyValue) {
        continue;
      }

      // add key to index
      target.duplicateKeys[duplicateKey].push(duplicateKeyValue);
    }
  }

  // if empty - then remove key
  if (
    !target.duplicateKeys[duplicateKey] ||
    target.duplicateKeys[duplicateKey].length < 1
  ) {
    delete target.duplicateKeys[duplicateKey];
  }
};

/**
 * Fill geoLocation information for items in data
 * @param {Array} data - List of items that need to be checked for geolocation information
 * @param {string} addressPath - Path to an item's address/addresses
 * @param {Object} app - Loopback app
 * @returns {Promise<void>|*}
 */
const fillGeoLocationInformation = (data, addressPath, app) => {
  // create map of locations for which we need to get lat/lng information to the paths that need to be filled
  const locationsToFillPathsMap = data.reduce((acc, item, itemIndex) => {
    const address = _.get(item, addressPath);
    if (!address) {
      return acc;
    }

    // normalize item address to array of addresses to continue with only one code
    let isArray = true;
    let addressesArray;
    if (!Array.isArray(address)) {
      addressesArray = [address];
      isArray = false;
    } else {
      addressesArray = address;
    }

    addressesArray.forEach((address, addressIndex) => {
      const addressLat = _.get(address, 'geoLocation.lat');
      const addressLng = _.get(address, 'geoLocation.lng');
      const addressLatSet = addressLat || addressLat === 0;
      const addressLngSet = addressLng || addressLng === 0;

      // stop if locationId is not set or both geolocation properties are set
      if (
        !address.locationId ||
        addressLatSet && addressLngSet
      ) {
        return;
      }

      // add paths that will need to be filled with lat/lng for the address
      if (!acc[address.locationId]) {
        acc[address.locationId] = {
          lat: [],
          lng: []
        };
      }

      // set both lat/lng; doesn't matter if one of them is sent
      acc[address.locationId].lat.push(`${itemIndex}.${addressPath}${isArray ? `.${addressIndex}` : ''}.geoLocation.lat`);
      acc[address.locationId].lng.push(`${itemIndex}.${addressPath}${isArray ? `.${addressIndex}` : ''}.geoLocation.lng`);
    });

    return acc;
  }, {});

  const locationIds = Object.keys(locationsToFillPathsMap);

  // stop if there are no locations to be retrieved
  if (!locationIds.length) {
    return Promise.resolve();
  }

  // get locations and fill recorded paths with the needed information
  return app.models.location
    .rawFind({
      _id: {
        '$in': locationIds
      }
    }, {
      projection: {
        geoLocation: 1
      }
    })
    .then(locations => {
      locations.forEach(location => {
        const locationCoordinates = _.get(location, 'geoLocation.coordinates', []);
        if (!locationCoordinates.length) {
          return;
        }

        const pathsToFill = locationsToFillPathsMap[location.id];
        pathsToFill.lat.forEach(path => {
          _.set(data, path, location.geoLocation.coordinates[1]);
        });
        pathsToFill.lng.forEach(path => {
          _.set(data, path, location.geoLocation.coordinates[0]);
        });
      });

      return Promise.resolve();
    });
};

// update number of contacts and exposures for a person
const countPeopleContactsAndExposures = function (record) {
  // initialize number of contacts / exposures
  const result = {
    numberOfContacts: 0,
    numberOfExposures: 0
  };

  // go through relationship data and determine contacts / exposures count
  (record.relationshipsRepresentation || []).forEach((relData) => {
    if (relData.source) {
      result.numberOfContacts++;
    } else {
      result.numberOfExposures++;
    }
  });

  // finish
  return result;
};

/**
 * Generate random numbers between min & max
 * @param {number} minValue
 * @param {number} maxValue
 * @param {number} precision
 * @returns {number}
 */
const randomFloatBetween = (
  minValue,
  maxValue,
  precision
) => {
  if (typeof (precision) === 'undefined') {
    precision = 2;
  }
  return parseFloat(Math.min(minValue + (Math.random() * (maxValue - minValue)), maxValue).toFixed(precision));
};

/**
 * Generate random string for given charset
 * @param {string} charset - If not present the charset will be chose randomly
 * @param {number} minLength - Minimum length of random string
 * @param {number} maxLength - Maximum length of random string
 * @return {String}
 */
const randomString = (charset, minLength, maxLength) => {
  // variables for names generation
  const charsetType = ['default', 'french', 'chinese', 'number', 'symbol', 'all'];
  const charsetMap = {
    default: 'abcdefghijklmnopqrstuvwxyz',
    get french() {
      return `${this.default}çàèîûôöïüù`;
    },
    chinese: '常用國字標準字體表形表',
    number: '1234567890',
    symbol: '`~!@#$%^&*()_+=-}{][|":;\'\\?><,./',
    get all() {
      return `${this.french}${this.chinese}${this.number}${this.symbol}`;
    }
  };
  const charsetsNo = charsetType.length;

  if (!charset) {
    charset = charsetType[randomFloatBetween(0, charsetsNo - 1, 0)];
  }

  return randomize('?', randomFloatBetween(minLength, maxLength, 0), {chars: charsetMap[charset]});
};

Object.assign(module.exports, {
  streamToBuffer: streamUtils.streamToBuffer,
  remapProperties: remapProperties,
  getAsciiString: getAsciiString,
  getChunksForInterval: getChunksForInterval,
  extractImportableFields: extractImportableFields,
  extractImportableFieldsNoModel: extractImportableFieldsNoModel,
  exportListFile: exportListFile,
  exportListFileSync: exportListFileSync,
  getReferencedValue: getReferencedValue,
  resolveModelForeignKeys: resolveModelForeignKeys,
  getFlatObject: getFlatObject,
  parseModelFieldValues: parseModelFieldValues,
  isPathOK: isPathOK,
  formatDateFields: formatDateFields,
  formatUndefinedValues: formatUndefinedValues,
  translateDataSetReferenceDataValues: translateDataSetReferenceDataValues,
  translateFieldLabels: translateFieldLabels,
  includeSubLocationsInLocationFilter: includeSubLocationsInLocationFilter,
  translateQuestionAnswers: translateQuestionAnswers,
  getBuildInformation: getBuildInformation,
  getModelPropertiesByDataType: getModelPropertiesByDataType,
  getQuestionnaireDateProperties: getQuestionnaireDateProperties,
  convertPropertiesNoModelByType: convertPropertiesNoModelByType,
  getSourceAndTargetFromModelHookContext: getSourceAndTargetFromModelHookContext,
  setOriginalValueInContextOptions: setOriginalValueInContextOptions,
  getOriginalValueFromContextOptions: getOriginalValueFromContextOptions,
  paginateResultSet: paginateResultSet,
  setValueInOptions: setValueInOptions,
  setValueInContextOptions: setValueInContextOptions,
  getValueFromOptions: getValueFromOptions,
  getValueFromContextOptions: getValueFromContextOptions,
  getPeriodIntervalForDate: getPeriodIntervalForDate,
  sha256: sha256,
  migrateModelDataInBatches: migrateModelDataInBatches,
  covertAddressesGeoPointToLoopbackFormat: covertAddressesGeoPointToLoopbackFormat,
  sortMultiAnswerQuestions: sortMultiAnswerQuestions,
  convertQuestionStringDatesToDates: convertQuestionStringDatesToDates,
  convertQuestionAnswerToOldFormat: convertQuestionAnswerToOldFormat,
  convertQuestionnaireAnswersToOldFormat: convertQuestionnaireAnswersToOldFormat,
  convertQuestionnaireAnswersToNewFormat: convertQuestionnaireAnswersToNewFormat,
  getDateChunks: getDateChunks,
  convertQuestionnairePropsToDate: convertQuestionnairePropsToDate,
  getFilterCustomOption: getFilterCustomOption,
  attachLocations: attachLocations,
  getCaptchaConfig: getCaptchaConfig,
  handleActionsInBatches: handleActionsInBatches,
  extractVariablesAndAnswerOptions: extractVariablesAndAnswerOptions,
  sanitizePersonAddresses: sanitizePersonAddresses,
  sanitizePersonVisualId: sanitizePersonVisualId,
  processMapLists: processMapLists,
  remapPropertiesUsingProcessedMap: remapPropertiesUsingProcessedMap,
  getDuplicateKey,
  attachDuplicateKeys,
  fillGeoLocationInformation,
  countPeopleContactsAndExposures,
  randomString,
  DATA_TYPE: DATA_TYPE,
  DEFAULT_LANGUAGE: DEFAULT_LANGUAGE,
  DEFAULT_SYSTEM_ADMIN_ID: DEFAULT_SYSTEM_ADMIN_ID
});
