'use strict';

module.exports = {};

// dependencies
const momentLib = require('moment');
const momentRange = require('moment-range');
const moment = momentRange.extendMoment(momentLib);
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
const EpiWeek = require('epi-week');
const config = require('../server/config');
const MongoDBHelper = require('./mongoDBHelper');
const anonymizeDatasetFields = require('./anonymizeDatasetFields');
const mergeFilters = require('./mergeFilters');
const baseLanguageModel = require('./baseModelOptions/language');
const aesCrypto = require('./aesCrypto');
const { performance } = require('perf_hooks');
const excel = require('exceljs');
const uuid = require('uuid');
const tmp = require('tmp');
const path = require('path');

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
  let momentDate = date ? moment.utc(date).startOf('day') : moment.utc(moment().format('YYYY-MM-DD')).startOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Convert a Date object into moment date and reset time to end of the day
 * Additionally if dayOfWeek is sent the function will return the date for the date's corresponding day of the week
 * @param date If no date is given, the current datetime is returned
 * @param dayOfWeek If not sent the date will not be changed
 */
const getDateEndOfDay = function (date, dayOfWeek) {
  let momentDate = date ? moment.utc(date).endOf('day') : moment.utc(moment().format('YYYY-MM-DD')).endOf('day');
  return !dayOfWeek ? momentDate : momentDate.day(dayOfWeek);
};

/**
 * Get difference between dates in days
 * @param startDate
 * @param endDate
 */
const getDaysSince = function (startDate, endDate) {
  return (getDate(endDate)).diff(getDate(startDate), 'days');
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
  start = getDate(start);
  end = getDateEndOfDay(end);
  let result = [];
  switch (chunkType) {
    case 'day':
      let range = moment.range(start, end);
      result = Array.from(range.by('day')).map(day => ({start: getDate(day), end: getDateEndOfDay(day)}));
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
          start: getDate(date.clone()),
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
  interval[0] = getDate(interval[0]);
  interval[1] = getDateEndOfDay(interval[1]);

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
function remapPropertiesUsingProcessedMap(dataSet, processedMap, valuesMap, parentPath, dontRemoveEmptyData) {
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
        } else {
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
    let dataFromPath = _.get(data, arrayPath, []);
    dataFromPath = dataFromPath ? dataFromPath : [];
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
 * Format a date
 * If it fails, return empty string
 * @param value
 * @returns {string}
 */
const formatDate = function (value) {
  let result = '';
  if (value) {
    let tmpDate = moment(getDateDisplayValue(value));
    if (tmpDate.isValid()) {
      result = tmpDate.format('YYYY-MM-DD');
    }
  }
  return result;
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
        _.set(model, indicator.exactPath, formatDate(indicator.value));
      });
    } else {
      _.set(model, reference.exactPath, formatDate(reference.value));
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
              if (propertyName === 'usualPlaceOfResidenceLocationId.parentLocationIdFilter') {
                filter.usualPlaceOfResidenceLocationId = {
                  [inqKey]: locationIds
                };
              } else {
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
 * Check if a (string) date is valid (correct ISO format)
 * @param date
 * @return {boolean}
 */
const isValidDate = function (date) {
  return /^\d{4}-\d{2}-\d{2}[\sT]?(?:\d{2}:\d{2}:\d{2}(\.\d{3})?Z*)?$/.test(date);
};

/**
 * Check Model definition for boolean properties and get their references
 * Also checks for nested definitions
 * @param model Model definition
 * @param prefix Prefix to be attached to boolean properties when the model is nested; Must have the '.' suffix
 * @returns {[]}
 */
const getModelBooleanProperties = function (model, prefix = '') {
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
    // check if the property is supposed to be boolean
    if (model.definition.properties[propertyName].type) {
      // check for simple boolean prop
      if (model.definition.properties[propertyName].type.name === 'Boolean') {
        // store property name
        result.push(prefix + propertyName);
      }
        // check for model definition
      // eg: address: "address"
      else if (typeof model.definition.properties[propertyName].type === 'function') {
        result = result.concat(getModelBooleanProperties(model.definition.properties[propertyName].type, propertyName + '.'));
      }
        // check for array of model definitions
      // eg: persons: ["relationshipParticipant"]
      else if (
        Array.isArray(model.definition.properties[propertyName].type) &&
        typeof model.definition.properties[propertyName].type[0] === 'function'
      ) {
        result = result.concat(getModelBooleanProperties(model.definition.properties[propertyName].type[0], propertyName + arrayIdentifier));
      }
    }
  });

  return result;
};

/**
 * Convert boolean model properties to correct boolean values from strings
 * @param Model
 * @param dataSet [object|array]
 */
const convertBooleanProperties = function (Model, dataSet) {
  /**
   * Set property boolean value on a record given its reference
   * Also accepts array references
   * @param record Record to be updated
   * @param propRef Property reference
   */
  const setValueOnRecordProperty = function (record, propRef) {
    let propRefValues = getReferencedValue(record, propRef);
    // if it's single value, convert it to array (simplify the code)
    if (!Array.isArray(propRefValues)) {
      propRefValues = [propRefValues];
    }
    // go through all the found values
    propRefValues.forEach(refValue => {
      // if it has a value but the value is not boolean
      if (refValue.value != null && typeof refValue.value !== 'boolean') {
        _.set(record, refValue.exactPath, ['1', 'true'].includes(refValue.value.toString().toLowerCase()));
      }
    });
  };

  // init model boolean properties, if not already done
  if (!Model._booleanProperties) {
    // keep a list of boolean properties
    Model._booleanProperties = getModelBooleanProperties(Model);
  }

  /**
   * Convert boolean model properties for a single record instance
   * @param record
   */
  function convertBooleanModelProperties(record) {
    // check each property that is supposed to be boolean
    Model._booleanProperties.forEach(function (booleanProperty) {
      setValueOnRecordProperty(record, booleanProperty);
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
 * TODO: copied from convertBooleanProperties and updated to not used Loopback models; Should be used everywhere instead of the old function
 * Convert boolean model properties to correct boolean values from strings
 * @param {Array} modelBooleanProperties
 * @param {Object|Array} dataSet
 */
const convertBooleanPropertiesNoModel = function (modelBooleanProperties, dataSet) {
  /**
   * Set property boolean value on a record given its reference
   * Also accepts array references
   * @param record Record to be updated
   * @param propRef Property reference
   */
  const setValueOnRecordProperty = function (record, propRef) {
    let propRefValues = getReferencedValue(record, propRef);
    // if it's single value, convert it to array (simplify the code)
    if (!Array.isArray(propRefValues)) {
      propRefValues = [propRefValues];
    }
    // go through all the found values
    propRefValues.forEach(refValue => {
      // if it has a value but the value is not boolean
      if (refValue.value != null && typeof refValue.value !== 'boolean') {
        _.set(record, refValue.exactPath, ['1', 'true'].includes(refValue.value.toString().toLowerCase()));
      }
    });
  };

  /**
   * Convert boolean model properties for a single record instance
   * @param record
   */
  function convertBooleanModelProperties(record) {
    // check each property that is supposed to be boolean
    modelBooleanProperties.forEach(function (booleanProperty) {
      setValueOnRecordProperty(record, booleanProperty);
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
 * Go through questionnaire columns and rename if they have the same header name
 */
const renameDuplicateQuestionnaireHeaderColumns = (questionnaireData) => {
  // determine items for which we need to change column headers due to duplicate conflicts
  const addKeysToHeaderWithIndexes = {};
  questionnaireData.forEach((questionnaireColumnData1, questionnaireColumnDataIndex1) => {
    questionnaireData.forEach((questionnaireColumnData2, questionnaireColumnDataIndex2) => {
      // if same then we need to jump over
      if (
        !questionnaireColumnData1.expandKey ||
        !questionnaireColumnData2.expandKey ||
        questionnaireColumnData1.expandKey === questionnaireColumnData2.expandKey
      ) {
        return;
      }

      // same translation ?
      if (questionnaireColumnData1.expandHeader.toLowerCase() === questionnaireColumnData2.expandHeader.toLowerCase()) {
        addKeysToHeaderWithIndexes[questionnaireColumnDataIndex1] = true;
        addKeysToHeaderWithIndexes[questionnaireColumnDataIndex2] = true;
      }
    });
  });

  // change headers
  Object.keys(addKeysToHeaderWithIndexes).forEach((questionnaireColumnDataIndex) => {
    const questionnaireColumnData = questionnaireData[questionnaireColumnDataIndex];
    questionnaireColumnData.expandHeader = `${questionnaireColumnData.expandHeader} (${questionnaireColumnData.expandKey})`;
    questionnaireColumnData.header = `${questionnaireColumnData.header} (${questionnaireColumnData.expandKey})`;
  });
};

/**
 * Retrieve list of questionnaire questions and their variables
 * @param questionnaire
 * @param idHeaderPrefix
 * @param dictionary
 * @param useVariable
 * @param multiDateLengthsMap
 * @param isNestedMultiDate
 * @param multiDateIndex
 * @returns {[{id, header}]}
 */
const retrieveQuestionnaireVariables = (questionnaire, idHeaderPrefix, dictionary, useVariable, multiDateLengthsMap, isNestedMultiDate, multiDateIndex) => {
  if (_.isEmpty(questionnaire)) {
    return [];
  }

  const result = [];
  _.each(questionnaire, (question) => {
    if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP') {
      result.push({
        expandKey: question.variable,
        expandHeader: useVariable ? question.variable : dictionary.getTranslation(question.text),
        id: (idHeaderPrefix ? idHeaderPrefix + ' ' : '') + question.variable,
        header: useVariable ? question.variable : dictionary.getTranslation(question.text)
      });
      return;
    }
    if (!_.isEmpty(question.variable)) {
      const isMultiDate = question.multiAnswer || isNestedMultiDate;
      multiDateLengthsMap[question.variable] = multiDateLengthsMap[question.variable] || 0;

      if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
        if (!_.isEmpty(question.answers)) {
          if (isMultiDate) {
            const addQuestionAndAnswers = (multiDateIndex) => {
              _.each(question.answers, (answer, answerIndex) => {
                result.push({
                  id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} date`,
                  header: `${(useVariable ? question.variable : dictionary.getTranslation(question.text))} [MD ${multiDateIndex}]`
                });

                result.push({
                  expandKey: question.variable,
                  expandHeader: useVariable ? question.variable : dictionary.getTranslation(question.text),
                  id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} value ${(answerIndex + 1)}`,
                  header: `${(useVariable ? question.variable : dictionary.getTranslation(question.text))} ${(answerIndex + 1)} [MV ${multiDateIndex}]`
                });

                if (!_.isEmpty(answer.additionalQuestions)) {
                  result.push(...retrieveQuestionnaireVariables(
                    answer.additionalQuestions,
                    idHeaderPrefix,
                    dictionary,
                    useVariable,
                    multiDateLengthsMap,
                    isMultiDate,
                    multiDateIndex
                  ));
                }
              });
            };
            if (multiDateIndex) {
              addQuestionAndAnswers(multiDateIndex);
            } else {
              for (let i = 0; i < multiDateLengthsMap[question.variable]; i++) {
                addQuestionAndAnswers(i + 1);
              }
            }
          } else {
            _.each(question.answers, (answer, answerIndex) => {
              result.push({
                expandKey: question.variable,
                expandHeader: useVariable ? question.variable : dictionary.getTranslation(question.text),
                id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} 1 value ${(answerIndex + 1)}`,
                header: `${(useVariable ? question.variable : dictionary.getTranslation(question.text))} ${(answerIndex + 1)}`
              });

              if (!_.isEmpty(answer.additionalQuestions)) {
                result.push(...retrieveQuestionnaireVariables(
                  answer.additionalQuestions,
                  idHeaderPrefix,
                  dictionary,
                  useVariable,
                  multiDateLengthsMap,
                  isMultiDate,
                  multiDateIndex
                ));
              }
            });
          }
        }
      } else {
        if (isMultiDate) {
          const addQuestionAndAnswers = (multiDateIndex) => {
            result.push(
              {
                id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} date`,
                header: `${(useVariable ? question.variable : dictionary.getTranslation(question.text))} [MD ${multiDateIndex}]`
              },
              {
                expandKey: question.variable,
                expandHeader: useVariable ? question.variable : dictionary.getTranslation(question.text),
                id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} value`,
                header: `${(useVariable ? question.variable : dictionary.getTranslation(question.text))} [MV ${multiDateIndex}]`
              }
            );

            // add children questions
            if (!_.isEmpty(question.answers)) {
              _.each(question.answers, (answer) => {
                if (!_.isEmpty(answer.additionalQuestions)) {
                  result.push(...retrieveQuestionnaireVariables(
                    answer.additionalQuestions,
                    idHeaderPrefix,
                    dictionary,
                    useVariable,
                    multiDateLengthsMap,
                    isMultiDate,
                    multiDateIndex
                  ));
                }
              });
            }
          };
          if (multiDateIndex) {
            addQuestionAndAnswers(multiDateIndex);
          } else {
            for (let i = 0; i < multiDateLengthsMap[question.variable]; i++) {
              addQuestionAndAnswers(i + 1);
            }
          }
        } else {
          result.push({
            expandKey: question.variable,
            expandHeader: useVariable ? question.variable : dictionary.getTranslation(question.text),
            id: (idHeaderPrefix ? idHeaderPrefix + ' ' : '') + question.variable + ' 1 value',
            header: useVariable ? question.variable : dictionary.getTranslation(question.text)
          });

          if (!_.isEmpty(question.answers)) {
            _.each(question.answers, (answer) => {
              if (!_.isEmpty(answer.additionalQuestions)) {
                result.push(...retrieveQuestionnaireVariables(
                  answer.additionalQuestions,
                  idHeaderPrefix,
                  dictionary,
                  useVariable,
                  multiDateLengthsMap,
                  isMultiDate,
                  multiDateIndex
                ));
              }
            });
          }
        }
      }
    }
  });

  // loop through headers and add variables to duplicate translations
  if (
    result &&
    result.length > 1
  ) {
    renameDuplicateQuestionnaireHeaderColumns(result);
  }

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
    date = getDate(date).isAfter(fullPeriodInterval[0]) ? date : getDate(fullPeriodInterval[0]);
    date = getDate(date).isBefore(fullPeriodInterval[1]) ? date : getDateEndOfDay(fullPeriodInterval[1]);
  }

  // get period in which the case needs to be included
  let startDay, endDay;
  switch (periodType) {
    case 'day':
      // get day interval for date
      startDay = getDate(date);
      endDay = getDateEndOfDay(date);
      break;
    case 'week':
      // get week interval for date
      weekType = weekType || 'iso';
      switch (weekType) {
        case 'iso':
          startDay = getDate(date).startOf('isoWeek');
          endDay = getDateEndOfDay(date).endOf('isoWeek');
          break;
        case 'sunday':
          startDay = getDate(date).startOf('week');
          endDay = getDateEndOfDay(date).endOf('week');
          break;
        case 'epi':
          date = getDate(date);
          const epiWeek = EpiWeek(date.clone().toDate());
          startDay = date.clone().week(epiWeek.week).startOf('week');
          endDay = date.clone().week(epiWeek.week).endOf('week');
          break;
      }

      break;
    case 'month':
      // get month period interval for date
      startDay = getDate(date).startOf('month');
      endDay = getDateEndOfDay(date).endOf('month');
      break;
  }

  // make sure dates are in interval limits
  if (
    fullPeriodInterval &&
    fullPeriodInterval.length > 1
  ) {
    startDay = startDay.isAfter(fullPeriodInterval[0]) ? startDay : getDate(fullPeriodInterval[0]);
    endDay = endDay.isBefore(fullPeriodInterval[1]) ? endDay : getDateEndOfDay(fullPeriodInterval[1]);
    endDay = endDay.isAfter(startDay) ? endDay : getDateEndOfDay(startDay);
  }

  // return period interval
  return [startDay.toString(), endDay.toString()];
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
    addressesToUpdate = modelInstance.addresses;
  }

  // do we need to convert fill location two ?
  // make sure we don't alter the original array
  if (!_.isEmpty(modelInstance.fillLocation)) {
    addressesToUpdate = [
      ...addressesToUpdate,
      modelInstance.fillLocation
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
        answers[prop] = answers[prop].sort((a, b) => moment(b.date).format('X') - moment(a.date).format('X'));
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
      convertPropsToDate(modelChanges.questionnaireAnswers);

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

const getQuestionnaireMaxAnswersMap = function (questionnaire, records, translationOpts) {
  translationOpts = translationOpts || {
    questionToTranslationMap: []
  };
  questionnaire = (questionnaire || []).filter(q => q.multiAnswer);

  // get a map of all the multi date answer questions and their nested questions
  let multiDateQuestionsMap = {};

  (function parseQuestion(questions) {
    (questions || []).forEach(question => {
      multiDateQuestionsMap[question.variable] = [];
      (question.answers || []).forEach(answer => parseQuestion(answer.additionalQuestions));
    });
  })(questionnaire);

  // get maximum number of multi date answers
  records.forEach(record => {
    let propToIterate = 'questionnaireAnswers';
    if (!record[propToIterate]) {
      if (record[translationOpts.containerPropTranslation]) {
        propToIterate = translationOpts.containerPropTranslation;
      } else {
        // it doesn't have any questions, skip it
        return;
      }
    }
    for (let q in record[propToIterate]) {
      if (record[propToIterate].hasOwnProperty(q)) {
        if (multiDateQuestionsMap[q]) {
          multiDateQuestionsMap[q].push(record[propToIterate][q].length);
        } else {
          const foundMap = translationOpts.questionToTranslationMap.find(qMap => qMap.translation === q);
          if (foundMap) {
            multiDateQuestionsMap[foundMap.variable].push(record[propToIterate][q].length);
          }
        }
      }
    }
  });

  for (let q in multiDateQuestionsMap) {
    if (multiDateQuestionsMap.hasOwnProperty(q)) {
      let max = 0;
      if (multiDateQuestionsMap[q].length) {
        max = Math.max(...multiDateQuestionsMap[q]);
      }
      multiDateQuestionsMap[q] = max;
    }
  }

  return multiDateQuestionsMap;
};

const convertQuestionnairePropsToDate = function (questions) {
  const parseProp = function (prop) {
    if (prop === null || prop === 'undefined') {
      return prop;
    }
    // try to convert the string value to date, if valid, replace the old value
    if (isValidDate(prop)) {
      let convertedDate = getDate(prop);
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

const removeFilterOptions = function (filter, options) {
  filter = filter || {};
  filter.where = filter.where || {};
  for (let opt of options) {
    delete filter.where[opt];
  }
  return filter;
};

const attachCustomDeleteFilterOption = function (filter) {
  filter = filter || {};
  filter.where = filter.where || {};
  if (filter.deleted) {
    filter.where.includeDeletedRecords = true;
  }
  return filter;
};

const getMaximumLengthForArrays = function (items, props) {
  const propsLengths = {};
  props.forEach(prop => {
    propsLengths[prop] = [];
  });

  items.forEach(item => {
    props.forEach(prop => {
      if (Array.isArray(item[prop])) {
        propsLengths[prop].push(item[prop].length);
      }
    });
  });

  for (let p in propsLengths) {
    if (propsLengths.hasOwnProperty(p)) {
      let max = 0;
      if (propsLengths[p].length) {
        max = Math.max(...propsLengths[p]);
      }
      propsLengths[p] = max;
    }
  }

  return propsLengths;
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
 * Export filtered model list
 * @param parentCallback Used to send data to parent (export log id / errors)
 * @param modelOptions Options for the model that will be exported
 * @param query
 * @param exportType
 * @param encryptPassword {string|null}
 * @param anonymizeFields
 * @param fieldsGroupList
 * @param options
 */
function exportFilteredModelsList(
  parentCallback,
  modelOptions,
  filter,
  exportType,
  encryptPassword,
  anonymizeFields,
  fieldsGroupList,
  options
) {
  // prepare query filters
  const initializeQueryFilters = () => {
    // filter
    let dataFilter = filter?
      _.cloneDeep(filter) :
      {};

    // check for additional scope query that needs to be added
    if (modelOptions.scopeQuery) {
      dataFilter = mergeFilters(
        dataFilter,
        modelOptions.scopeQuery
      );
    }

    // check for deleted flag; by default all items will be retrieved including deleted
    if (!dataFilter.deleted) {
      dataFilter = mergeFilters(dataFilter, {
        where: {
          deleted: false
        }
      });
    }

    // convert loopback query to mongodb query
    dataFilter = MongoDBHelper.getMongoDBOptionsFromLoopbackFilter(dataFilter);

    // finished
    return dataFilter;
  };

  // initialize column headers
  const initializeColumnHeaders = () => {
    // get fields that need to be exported from model options
    let fieldLabelsMap = modelOptions.sanitizeFieldLabelsMapForExport ?
      modelOptions.sanitizeFieldLabelsMapForExport() :
      Object.assign(
        {},
        modelOptions.fieldLabelsMap
      );

    // filter field labels list if fields groups were provided
    let modelExportFieldsOrder = modelOptions.exportFieldsOrder;
    if (
      fieldsGroupList &&
      fieldsGroupList.length > 0 &&
      modelOptions.exportFieldsGroup
    ) {
      // get all properties from each fields group
      const exportFieldLabelsMap = {};
      Object.keys(modelOptions.exportFieldsGroup).forEach((groupName) => {
        if (fieldsGroupList.includes(groupName)) {
          if (
            modelOptions.exportFieldsGroup[groupName].properties &&
            modelOptions.exportFieldsGroup[groupName].properties.length
          ) {
            modelOptions.exportFieldsGroup[groupName].properties.forEach((propertyName) => {
              // add property and token
              if (fieldLabelsMap[propertyName]) {
                exportFieldLabelsMap[propertyName] = fieldLabelsMap[propertyName];
              }
            });
          }
        }
      });

      // use the headers come from export
      if (!_.isEmpty(exportFieldLabelsMap)) {
        // update the new list of exported fields
        fieldLabelsMap = exportFieldLabelsMap;

        // ignore export fields order
        modelExportFieldsOrder = undefined;
      }
    }

    // some models may have a specific order for headers
    let fieldsList = [];
    const fieldLabelsKeys = Object.keys(fieldLabelsMap);
    if (!_.isEmpty(modelExportFieldsOrder)) {
      // start with items from our order
      fieldsList = modelExportFieldsOrder;
      const alreadyIncludedFields = _.invert(modelExportFieldsOrder);

      // add the rest of the fields
      fieldLabelsKeys.forEach((field) => {
        // already include ?
        if (alreadyIncludedFields[field] !== undefined) {
          return;
        }

        // add it to the list
        fieldsList.push(field);
      });
    } else {
      fieldsList = fieldLabelsKeys;
    }

    // replace id with _id since were using mongo without loopback
    const idIndex = fieldsList.indexOf('id');
    if (idIndex > -1) {
      fieldsList.splice(
        idIndex,
        1,
        '_id'
      );
    }
    if (fieldLabelsMap.id) {
      fieldLabelsMap._id = fieldLabelsMap.id;
      delete fieldLabelsMap.id;
    }

    // finished
    return {
      headerKeys: fieldsList,
      headerColumns: [],
      arrayColumnMaxValues: {},
      labels: fieldLabelsMap,

      // location fields
      includeParentLocationData: fieldsGroupList && fieldsGroupList.length > 0 && modelOptions.exportFieldsGroup ?
        fieldsGroupList.includes('LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA') :
        true,
      locationsFieldsMap: !modelOptions.locationFields || modelOptions.locationFields.length < 1 ?
        {} :
        modelOptions.locationFields.reduce(
          (acc, property) => {
            // attach prop
            acc[property] = true;

            // continue
            return acc;
          },
          {}
        )
    };
  };

  // prefix name so we don't encounter duplicates
  const getQuestionnaireQuestionUniqueKey = (key) => {
    return `_${key}`;
  };

  // prefix name so we don't encounter duplicates for multiple dropdown
  const getQuestionnaireQuestionUniqueKeyForMultipleAnswers = (key) => {
    return `${getQuestionnaireQuestionUniqueKey(key)}_multiple`;
  };

  // prepare questionnaire data
  const prepareQuestionnaireData = () => {
    // go through questionnaire questions and map them accordingly
    const response = {
      flat: [],
      nonFlat: []
    };
    if (
      options.questionnaire &&
      options.questionnaire.length > 0
    ) {
      // what is important to keep from a question
      const addQuestionData = (
        flatArray,
        nonFlatArray,
        question
      ) => {
        // some types are ignored since there is no point in exporting them ?
        if (
          !question.text ||
          !question.text.startsWith('LNG_') ||
          !question.variable ||
          question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP'
        ) {
          return;
        }

        // init question
        const formattedQuestion = {
          variable: question.variable,
          text: question.text,
          answerType : question.answerType,
          childQuestions: []
        };

        // attach question to flat array
        flatArray.push(formattedQuestion);

        // add to non flat array if we have one
        if (nonFlatArray) {
          nonFlatArray.push(formattedQuestion);
        }

        // attach child question recursively so they keep the order of display
        if (
          question.answers &&
          question.answers.length > 0
        ) {
          question.answers.forEach((answer) => {
            if (
              answer &&
              answer.additionalQuestions &&
              answer.additionalQuestions.length > 0
            ) {
              answer.additionalQuestions.forEach((childQuestion) => {
                addQuestionData(
                  flatArray,
                  formattedQuestion.childQuestions,
                  childQuestion
                );
              });
            }
          });
        }
      };

      // format questionnaire
      options.questionnaire.forEach((questionData) => {
        // attach our question and it children question one after another
        addQuestionData(
          response.flat,
          response.nonFlat,
          questionData
        );
      });
    }

    // finished
    return response;
  };

  // prepare temporary workbook
  const initializeTemporaryWorkbook = () => {
    // create stream workbook so we can write in it when we have data
    const exportLogId = uuid.v4();
    const filePath = path.resolve(tmp.tmpdir, exportLogId);
    const tmpWorkbook = new excel.stream.xlsx.WorkbookWriter({
      filename: filePath
    });

    // add sheet where we will export data
    const tmpWorksheet = tmpWorkbook.addWorksheet('Data');

    // header columns will be filled later when we have data
    // COLUMNS will be added in a later step

    // finished
    const columns = initializeColumnHeaders();
    return {
      languageId: options.contextUserLanguageId || defaultLanguage,
      exportLogId,
      temporaryCollectionName: `zExport_${exportLogId}`,
      temporaryDistinctLocationsKey: 'allUsedLocationIds',
      processedNo: 0,
      batchSize: config.export && config.export.batchSize > 0 ?
        config.export.batchSize :
        5000,
      locationFindBatchSize: config.export && config.export.locationFindBatchSize > 0 ?
        config.export.locationFindBatchSize :
        1000,
      saveFilter: config && config.export && !!config.export.saveFilter,
      saveAggregateFilter: config && config.export && !!config.export.saveAggregateFilter,
      filePath,
      columns,
      excel: {
        workbook: tmpWorkbook,
        worksheet: tmpWorksheet
      },

      // questionnaire
      questionnaireQuestionsData: prepareQuestionnaireData(),

      // dictionary
      dictionaryMap: {},

      // locations
      locationsMaxNumberOfIdentifiers: 0,
      locationsMaxSizeOfParentsChain: 0,
      locationsMap: {},

      // retrieve only the fields that we need
      projection: columns.headerKeys.reduce(
        (acc, property) => {
          // attach prop
          acc[property] = 1;

          // continue
          return acc;
        },
        {}
      ),

      // update export log
      updateExportLog: (dataToUpdate) => {
        // prepare data
        return exportLog
          .updateOne({
            _id: sheetHandler.exportLogId
          }, {
            '$set': dataToUpdate
          });
      }
    };
  };

  // used collection
  let exportLog, temporaryCollection, languageToken, location;

  // defaultLanguage must be initialized before initializeTemporaryWorkbook
  const defaultQuestionnaireAnswersKey = 'questionnaireAnswers';
  const defaultLanguage = 'english_us';
  const dataFilter = initializeQueryFilters();
  const sheetHandler = initializeTemporaryWorkbook();

  // drop collection
  const dropTemporaryCollection = () => {
    // temporary collection was initialized ?
    if (temporaryCollection) {
      return temporaryCollection
        .drop()
        .then(() => {
          temporaryCollection = undefined;
        });
    }

    // no temporary collection ?
    return Promise.resolve();
  };

  // retrieve mongo db connection - since this export will always run in a worker
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      // used collections
      const exportDataCollection = dbConn.collection(modelOptions.collectionName);
      exportLog = dbConn.collection('databaseActionLog');
      languageToken = dbConn.collection('languageToken');
      location = dbConn.collection('location');

      // initialize export log
      const initializeExportLog = () => {
        return exportLog
          .insertOne({
            _id: sheetHandler.exportLogId,
            type: 'export-data',
            actionStartDate: new Date(),
            status: 'LNG_SYNC_STATUS_IN_PROGRESS',
            statusStep: 'LNG_STATUS_STEP_RETRIEVING_LANGUAGE_TOKENS',
            resourceType: modelOptions.modelName,
            totalNo: 0,
            processedNo: 0,
            outbreakIDs: [options.outbreakId],
            deleted: false,
            createdAt: new Date(),
            createdBy: options.userId,
            updatedAt: new Date(),
            updatedBy: options.userId,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            extension: exportType,
            filter: sheetHandler.saveFilter ?
              JSON.stringify(dataFilter) :
              null
          })
          .then(() => {
            // send id to parent and proceed with doing the export
            parentCallback(null, {
              subject: 'WAIT',
              response: sheetHandler.exportLogId
            });
          });
      };

      // retrieve missing tokens
      const retrieveMissingTokens = (languageId, tokenIds) => {
        // default token projection
        const languageTokenProjection = {
          token: 1,
          translation: 1
        };

        // retrieve tokens
        // - preferably in user language but if not found in default language (english_us)
        return languageToken
          .find({
            languageId: languageId,
            token: {
              $in: tokenIds
            }
          }, {
            projection: languageTokenProjection
          })
          .toArray()
          .then((tokens) => {
            // map tokens
            // for faster then forEach :) - monumental gain :)
            for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
              // get record data
              const record = tokens[tokenIndex];
              sheetHandler.dictionaryMap[record.token] = record.translation;
            }

            // if records not found in current language try english
            if (
              languageId !== defaultLanguage &&
              tokenIds.length !== tokens.length
            ) {
              // find tokens that are missing
              const missingTokenIds = [];
              for (let missingTokenIndex = 0; missingTokenIndex < tokenIds.length; missingTokenIndex++) {
                // check if we have this token
                const token = tokenIds[missingTokenIndex];
                if (sheetHandler.dictionaryMap[token] !== undefined) {
                  // retrieved already
                  continue;
                }

                // append to missing tokens
                missingTokenIds.push(token);
              }

              // retrieve missing tokens
              return retrieveMissingTokens(
                defaultLanguage,
                missingTokenIds
              );
            }
          });
      };

      // initialize language tokens
      const initializeLanguageTokens = () => {
        // retrieve general language tokens
        const languageTokensToRetrieve = Object.values(sheetHandler.columns.labels);

        // attach general tokens that are always useful to have in your pocket
        languageTokensToRetrieve.push(
          'LNG_LOCATION_FIELD_LABEL_ID',
          'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS',
          'LNG_LOCATION_FIELD_LABEL_IDENTIFIER',
          'LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL'
        );

        // attach questionnaire tokens
        if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
          sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
            languageTokensToRetrieve.push(questionData.text);
          });
        }

        // retrieve language tokens
        return retrieveMissingTokens(
          sheetHandler.languageId,
          languageTokensToRetrieve
        );
      };

      // initialize collection view
      const initializeCollectionView = () => {
        // original project
        const project = {
          // force to keep object order by using the collection natural sort when retrieving data
          _id: 0,
          rowId: '$_id'
        };

        // IMPORTANT!!!
        // IMPORTANT!!!
        // IMPORTANT!!!
        // USING MongoDB 4.4+ would've allowed us to use $function to do all bellow which could've been much faster than having multiple lines of preparations
        // - we might change it after we upgrade from 3.2 to a newer version
        // #TODO

        // determine how many values we have for array properties
        const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
          [] :
          Object.keys(modelOptions.arrayProps);
        arrayProps.forEach((property) => {
          // array field value
          const fieldValue = `$${property}`;

          // attach projection
          project[property] = {
            $cond: {
              if: {
                $isArray: fieldValue
              },
              then: {
                $size: fieldValue
              },
              else: 0
            }
          };
        });

        // go through location fields so we can construct the retrieval of location ids
        const locationProps = _.isEmpty(sheetHandler.columns.locationsFieldsMap) ?
          [] :
          Object.keys(sheetHandler.columns.locationsFieldsMap);
        const locationContactQuery = {
          $concatArrays: []
        };
        locationProps.forEach((propertyName) => {
          // take action depending if field belong to an array of not
          const propertyArrayIndex = propertyName.indexOf('[]');
          if (propertyArrayIndex > -1) {
            // get array item field name - most of the time should be locationId, but you never know when earth is flat :)
            const arrayField = `$${propertyName.substr(0, propertyArrayIndex)}`;
            const locationItemProp = propertyName.substr(propertyName.lastIndexOf('.') + 1);

            // array merge
            locationContactQuery.$concatArrays.push({
              $cond: {
                if: {
                  $isArray: arrayField
                },
                then: {
                  $map: {
                    input: arrayField,
                    as: 'item',
                    in: `$$item.${locationItemProp}`
                  }
                },
                else: []
              }
            });
          } else {
            // not array
            locationContactQuery.$concatArrays.push([
              `$${propertyName}`
            ]);
          }
        });

        // attach location pipe if we have one
        if (locationContactQuery.$concatArrays) {
          project[sheetHandler.temporaryDistinctLocationsKey] = locationContactQuery;
        }

        // attach questionnaire count to know how many columns we should attach
        if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
          // construct the queries that will be used to determine the number of max columns
          sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
            // attach size answers per date count (multiple answer flag)
            const variableProp = `$${defaultQuestionnaireAnswersKey}.${questionData.variable}`;
            project[getQuestionnaireQuestionUniqueKey(questionData.variable)] = {
              $cond: {
                if: {
                  $isArray: variableProp
                },
                then: {
                  $size: variableProp
                },
                else: 0
              }
            };

            // attach max multiple answers per question answer (multi select dropdown)
            if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
              const variablePropMultiple = `${variableProp}.value`;
              project[getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable)] = {
                $let: {
                  vars: {
                    maxValue: {
                      $max: {
                        $map: {
                          input: {
                            $cond: {
                              if: {
                                $isArray: variablePropMultiple
                              },
                              then: {
                                $concatArrays: variablePropMultiple
                              },
                              else: []
                            }
                          },
                          as: 'item',
                          in: {
                            $cond: {
                              if: {
                                $isArray: '$$item'
                              },
                              then: {
                                $size: '$$item'
                              },
                              else: 0
                            }
                          }
                        }
                      }
                    }
                  },
                  in: {
                    $ifNull: ['$$maxValue', 0]
                  }
                }
              };
            }
          });
        }

        // aggregate filter
        const aggregateFilter = [
          {
            $match: dataFilter.where
          }, {
            $sort: dataFilter.sort
          }, {
            $project: project
          }, {
            $out: sheetHandler.temporaryCollectionName
          }
        ];

        // update export log in case we need the aggregate filter
        return sheetHandler
          .updateExportLog({
            aggregateFilter: sheetHandler.saveAggregateFilter ?
              JSON.stringify(aggregateFilter) :
              null,
            updatedAt: new Date()
          })
          .then(() => {
            // prepare records that will be exported
            return exportDataCollection
              .aggregate(aggregateFilter, {
                allowDiskUse: true
              })
              .toArray()
              .then(() => {
                temporaryCollection = dbConn.collection(sheetHandler.temporaryCollectionName);
              });
          });
      };

      // retrieve missing locations
      const retrieveMissingLocations = (locationIds) => {
        // retrieve locations in batches - just in case
        const locationIdsMap = {};
        return new Promise((resolve, reject) => {
          // batch handler
          const nextBatch = () => {
            // finished ?
            if (
              !locationIds ||
              locationIds.length < 1
            ) {
              return Promise.resolve();
            }

            // next batch to retrieve
            const batchLocationIds = locationIds.splice(
              0,
              sheetHandler.locationFindBatchSize
            );

            // retrieve locations
            return location
              .find({
                _id: {
                  $in: batchLocationIds
                }
              }, {
                projection: {
                  _id: 1,
                  name: 1,
                  identifiers: 1,
                  parentLocationId: 1,
                  geographicalLevelId: 1
                }
              })
              .toArray()
              .then((locations) => {
                // map locations
                for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
                  // get record data
                  const record = locations[locationIndex];
                  sheetHandler.locationsMap[record._id] = record;

                  // initialize parents chain
                  record.parentChain = [];

                  // update max number of identifier if necessary
                  sheetHandler.locationsMaxNumberOfIdentifiers = record.identifiers && record.identifiers.length > 0 && record.identifiers.length > sheetHandler.locationsMaxNumberOfIdentifiers ?
                    record.identifiers.length :
                    sheetHandler.locationsMaxNumberOfIdentifiers;
                }

                // no need to retrieve parent locations ?
                if (!sheetHandler.columns.includeParentLocationData) {
                  return;
                }

                // retrieve missing parent locations too
                // - need to loop again because otherwise we might include in missing something that is already retrieved but not added to map
                for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
                  // get record data
                  const record = locations[locationIndex];

                  // doesn't have parent, no point in continuing
                  if (!record.parentLocationId) {
                    continue;
                  }

                  // parent already retrieved, or will be retrieved ?
                  if (
                    sheetHandler.locationsMap[record.parentLocationId] ||
                    locationIdsMap[record.parentLocationId]
                  ) {
                    continue;
                  }

                  // missing parent
                  locationIdsMap[record.parentLocationId] = true;
                  locationIds.push(record.parentLocationId);
                }
              })
              .then(nextBatch);
          };

          // retrieve locations
          nextBatch()
            .then(resolve)
            .catch(reject);
        });

      };

      // retrieve locations and determine how many columns we will have - depending of identifiers
      const initializeLocations = () => {
        // retrieve all locations which are used in this export
        // - should we split into bulk? shouldn't be necessary..just for some ids
        return temporaryCollection
          .distinct(sheetHandler.temporaryDistinctLocationsKey)
          .then((locationIds) => {
            // no locations ?
            if (
              !locationIds ||
              locationIds.length < 1 ||
              (locationIds = locationIds.filter((locationId) => locationId)).length < 1
            ) {
              return;
            }

            // retrieve locations
            return retrieveMissingLocations(locationIds);
          })
          .then(() => {
            // determine longest parent location chain
            const locationIds = Object.keys(sheetHandler.locationsMap);
            for (let locationIndex = 0; locationIndex < locationIds.length; locationIndex++) {
              // get location
              const location = sheetHandler.locationsMap[locationIds[locationIndex]];

              // count parents
              let parentLocationId = location.parentLocationId;
              while (parentLocationId) {
                // attach parent to list
                location.parentChain.push(parentLocationId);

                // retrieve next parent from chain
                parentLocationId = sheetHandler.locationsMap[parentLocationId] ?
                  sheetHandler.locationsMap[parentLocationId].parentLocationId :
                  undefined;
              }

              // update max chain size if necessary
              sheetHandler.locationsMaxSizeOfParentsChain = location.parentChain.length > sheetHandler.locationsMaxSizeOfParentsChain ?
                location.parentChain.length :
                sheetHandler.locationsMaxSizeOfParentsChain;
            }
          });
      };

      // determine header columns
      const initializeColumns = () => {
        // initialize columns
        return Promise.resolve()
          .then(() => {
            // determine the maximum number for each array field
            const projectMax = {
              _id: null
            };
            const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
              [] :
              Object.keys(modelOptions.arrayProps);

            // nothing to retrieve ?
            if (arrayProps.length < 1) {
              return;
            }

            // go through array fields and construct query to determine maximum number of records
            arrayProps.forEach((property) => {
              // array field value
              const fieldValue = `$${property}`;

              // attach max projection
              projectMax[property] = {
                $max : fieldValue
              };
            });

            // determine maximum number of values per questionnaire answers too
            if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
              // construct the queries that will be used to determine the number of max columns
              sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
                // attach size answers per date count (multiple answer flag)
                const variableProp = getQuestionnaireQuestionUniqueKey(questionData.variable);
                projectMax[variableProp] = {
                  $max: `$${variableProp}`
                };

                // attach max multiple answers per question answer (multi select dropdown)
                if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                  const variablePropMultiple = getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable);
                  projectMax[variablePropMultiple] = {
                    $max: `$${variablePropMultiple}`
                  };
                }
              });
            }

            // determine maximum number of items for each array field
            return temporaryCollection
              .aggregate([{
                $group: projectMax
              }])
              .toArray();
          })
          .then((maxValues) => {
            // keep a copy of max counts
            sheetHandler.columns.arrayColumnMaxValues = maxValues && maxValues.length > 0 ?
              maxValues[0] :
              {};

            // handle adding columns to make sure they are all unitary
            const addHeaderColumn = (
              header,
              path,
              pathWithoutIndexes,
              uniqueKeyInCaseOfDuplicate,
              formula
            ) => {
              // create column
              const columnData = {
                originalHeader: header,
                uniqueKeyInCaseOfDuplicate,
                header,
                path,
                pathWithoutIndexes,
                formula
              };

              // check for duplicates
              for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
                // if not a duplicate header can jump over
                const existingColumn = sheetHandler.columns.headerColumns[columnIndex];
                if (existingColumn.originalHeader !== columnData.originalHeader) {
                  continue;
                }

                // duplicate header - append unique key
                columnData.header = `${columnData.originalHeader} (${columnData.uniqueKeyInCaseOfDuplicate})`;
                existingColumn.header = `${existingColumn.originalHeader} (${existingColumn.uniqueKeyInCaseOfDuplicate})`;

                // continue to check for other duplicates & replace their header too
              }

              // append column
              sheetHandler.columns.headerColumns.push(columnData);

              // in case we need it
              return columnData;
            };

            // remove previous column if path condition is met
            const removeLastColumnIfSamePath = (path) => {
              // nothing to do
              if (sheetHandler.columns.headerColumns.length < 1) {
                return;
              }

              // check if we need to remove it
              if (sheetHandler.columns.headerColumns[sheetHandler.columns.headerColumns.length - 1].path !== path) {
                return;
              }

              // meets the criteria, need to remove column
              sheetHandler.columns.headerColumns.splice(
                sheetHandler.columns.headerColumns.length - 1,
                1
              );
            };

            // attach parent location identifiers
            const attachLocationIdentifiers = (
              header,
              path,
              pathWithoutIndexes
            ) => {
              // attach location identifiers
              for (let identifierIndex = 0; identifierIndex < sheetHandler.locationsMaxNumberOfIdentifiers; identifierIndex++) {
                // attach location identifier
                addHeaderColumn(
                  `${header} [${identifierIndex + 1}]`,
                  path,
                  pathWithoutIndexes,
                  uuid.v4(),
                  (function (localIdentifierIndex) {
                    return (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].identifiers &&
                      sheetHandler.locationsMap[value].identifiers.length > localIdentifierIndex ?
                        sheetHandler.locationsMap[value].identifiers[localIdentifierIndex].code :
                        '';
                    };
                  })(identifierIndex)
                );
              }
            };

            // attach parent location details - only first level parent
            const attachParentLocationDetails = (
              header,
              path,
              pathWithoutIndexes
            ) => {
              // attach parent location details - only first level parent
              for (let parentLocationIndex = 0; parentLocationIndex < sheetHandler.locationsMaxSizeOfParentsChain; parentLocationIndex++) {
                // attach parent location geographical level
                addHeaderColumn(
                  `${header} [${parentLocationIndex + 1}]`,
                  path,
                  pathWithoutIndexes,
                  uuid.v4(),
                  (function (localParentLocationIndex) {
                    return (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentChain &&
                      sheetHandler.locationsMap[value].parentChain.length > localParentLocationIndex &&
                      sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]] &&
                      sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].geographicalLevelId ?
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].geographicalLevelId :
                        '';
                    };
                  })(parentLocationIndex)
                );
              }
            };

            // get properties of type array definitions if current model has one
            const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
              undefined :
              modelOptions.arrayProps;

            // for faster then forEach :) - monumental gain :)
            for (let propIndex = 0; propIndex < sheetHandler.columns.headerKeys.length; propIndex++) {
              // get record data
              const propertyName = sheetHandler.columns.headerKeys[propIndex];
              const propertyLabelToken = sheetHandler.columns.labels[propertyName];
              const propertyLabelTokenTranslation = propertyLabelToken && sheetHandler.dictionaryMap[propertyLabelToken] !== undefined ?
                sheetHandler.dictionaryMap[propertyLabelToken] :
                propertyLabelToken;

              // array property ?
              if (
                arrayProps &&
                arrayProps[propertyName]
              ) {
                // go through each child property and create proper header columns
                if (sheetHandler.columns.arrayColumnMaxValues[propertyName]) {
                  for (let arrayIndex = 0; arrayIndex < sheetHandler.columns.arrayColumnMaxValues[propertyName]; arrayIndex++) {
                    for (let childProperty in arrayProps[propertyName]) {
                      // determine child property information
                      const childPropertyTokenTranslation = sheetHandler.dictionaryMap[arrayProps[propertyName][childProperty]];

                      // child property contains parent info ?
                      const propertyOfAnObjectIndex = childProperty.indexOf('.');
                      if (propertyOfAnObjectIndex > -1) {
                        // determine parent property
                        const parentProperty = childProperty.substr(0, propertyOfAnObjectIndex);

                        // remove previous column if it was a parent column
                        if (parentProperty) {
                          removeLastColumnIfSamePath(`${propertyName}[${arrayIndex}].${parentProperty}`);
                        }
                      }

                      // add columns
                      const childColumn = addHeaderColumn(
                        `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}]`,
                        `${propertyName}[${arrayIndex}].${childProperty}`,
                        `${propertyName}[].${childProperty}`,
                        uuid.v4()
                      );

                      // if location column we need to push some extra columns
                      if (
                        sheetHandler.columns.includeParentLocationData &&
                        sheetHandler.columns.locationsFieldsMap[childColumn.pathWithoutIndexes]
                      ) {
                        // attach location guid
                        addHeaderColumn(
                          `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_ID']} [${arrayIndex + 1}]`,
                          `${propertyName}[${arrayIndex}].${childProperty}`,
                          childColumn.pathWithoutIndexes,
                          uuid.v4(),
                          (value) => {
                            return value;
                          }
                        );

                        // attach location identifiers
                        attachLocationIdentifiers(
                          `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']} [${arrayIndex + 1}] ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIER']}`,
                          `${propertyName}[${arrayIndex}].${childProperty}`,
                          childColumn.pathWithoutIndexes
                        );

                        // attach parent location details - only first level parent
                        attachParentLocationDetails(
                          `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}] ${sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']}`,
                          `${propertyName}[${arrayIndex}].${childProperty}`,
                          childColumn.pathWithoutIndexes
                        );
                      }
                    }
                  }
                }

                // property addressed through its children, no need to continue, and yet we continue - dev joke :) - jump to next item in for loop
                continue;
              }

              // do not handle array properties from field labels map when we have arrayProps set on the model
              const isPropertyOfAnArray = propertyName.indexOf('[]') > -1;
              if (
                isPropertyOfAnArray &&
                arrayProps
              ) {
                continue;
              }

              // if a flat file is exported, data needs to be flattened, include 3 elements for each array
              if (isPropertyOfAnArray) {
                // bad model configuration - missing definition
                // #TODO
                throw new Error(`Missing array definition for property '${propertyName}'`);
              } else {
                // check if property belongs to an object
                const propertyOfAnObjectIndex = propertyName.indexOf('.');
                let parentProperty, parentPropertyTokenTranslation;
                if (propertyOfAnObjectIndex > -1) {
                  parentProperty = propertyName.substr(0, propertyOfAnObjectIndex);
                  parentPropertyTokenTranslation = parentProperty && sheetHandler.dictionaryMap[parentProperty] ?
                    sheetHandler.dictionaryMap[parentProperty] :
                    undefined;
                }

                // if property belongs to an object then maybe we should remove the parent column since it isn't necessary anymore
                if (parentProperty) {
                  // remove parent column
                  removeLastColumnIfSamePath(parentProperty);

                  // add column
                  if (parentPropertyTokenTranslation) {
                    addHeaderColumn(
                      `${parentPropertyTokenTranslation} ${propertyLabelTokenTranslation}`,
                      propertyName,
                      propertyName,
                      uuid.v4()
                    );
                  } else {
                    // add column
                    addHeaderColumn(
                      propertyLabelTokenTranslation,
                      propertyName,
                      propertyName,
                      uuid.v4()
                    );
                  }
                } else {
                  // questionnaire column needs to be handled differently
                  if (
                    propertyName === defaultQuestionnaireAnswersKey &&
                    options.questionnaire &&
                    sheetHandler.questionnaireQuestionsData.nonFlat.length > 0
                  ) {
                    // add questionnaire columns
                    const addQuestionnaireColumns = (questionData) => {
                      // determine number of responses for this question
                      const queryKey = getQuestionnaireQuestionUniqueKey(questionData.variable);
                      let maxNoOfResponsesForThisQuestion = sheetHandler.columns.arrayColumnMaxValues[queryKey] ?
                        sheetHandler.columns.arrayColumnMaxValues[queryKey] :
                        0;

                      // we should export at least one round of columns even if we don't have data
                      maxNoOfResponsesForThisQuestion = maxNoOfResponsesForThisQuestion < 1 ?
                        1 :
                        maxNoOfResponsesForThisQuestion;

                      // we need to add question to which we don't have answers (we shouldn't have these cases)
                      // - because otherwise you will see child questions that you don't know for which parent question they were
                      // add number of column necessary to export all responses
                      for (let answerIndex = 0; answerIndex < maxNoOfResponsesForThisQuestion; answerIndex++) {
                        // question header
                        const questionHeader = sheetHandler.dictionaryMap[questionData.text] ?
                          sheetHandler.dictionaryMap[questionData.text] :
                          questionData.text;

                        // multiple dropdown ?
                        if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                          // determine number of max responses
                          const queryKeyForMultiple = getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable);
                          let maxNoOfResponsesForThisMultipleQuestion = sheetHandler.columns.arrayColumnMaxValues[queryKeyForMultiple] ?
                            sheetHandler.columns.arrayColumnMaxValues[queryKeyForMultiple] :
                            0;

                          // we should export at least one round of columns even if we don't have data
                          maxNoOfResponsesForThisMultipleQuestion = maxNoOfResponsesForThisMultipleQuestion < 1 ?
                            1 :
                            maxNoOfResponsesForThisMultipleQuestion;

                          // date needs to be printed just once
                          addHeaderColumn(
                            `${questionHeader} [MD ${answerIndex + 1}]`,
                            `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                            `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                            questionData.variable
                          );

                          // attach responses
                          for (let multipleAnswerIndex = 0; multipleAnswerIndex < maxNoOfResponsesForThisMultipleQuestion; multipleAnswerIndex++) {
                            // value
                            addHeaderColumn(
                              `${questionHeader} [MV ${answerIndex + 1}] ${multipleAnswerIndex + 1}`,
                              `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value[${multipleAnswerIndex}]`,
                              `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value[${multipleAnswerIndex}]`,
                              questionData.variable
                            );
                          }
                        } else {
                          // date
                          addHeaderColumn(
                            `${questionHeader} [MD ${answerIndex + 1}]`,
                            `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                            `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                            questionData.variable
                          );

                          // value
                          addHeaderColumn(
                            `${questionHeader} [MV ${answerIndex + 1}]`,
                            `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value`,
                            `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value`,
                            questionData.variable
                          );
                        }

                        // need to add child question columns before adding next index column for this question - to keep order of responses for each question
                        questionData.childQuestions.forEach((childQuestion) => {
                          addQuestionnaireColumns(childQuestion);
                        });
                      }
                    };

                    // construct columns for our questionnaire
                    sheetHandler.questionnaireQuestionsData.nonFlat.forEach((questionData) => {
                      addQuestionnaireColumns(questionData);
                    });
                  } else {
                    // add normal column
                    addHeaderColumn(
                      propertyLabelTokenTranslation,
                      propertyName,
                      propertyName,
                      uuid.v4()
                    );
                  }
                }

                // location field ?
                if (
                  sheetHandler.columns.includeParentLocationData &&
                  sheetHandler.columns.locationsFieldsMap[propertyName]
                ) {
                  // attach location identifiers
                  attachLocationIdentifiers(
                    `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIER']}`,
                    propertyName,
                    propertyName
                  );

                  // attach parent location details - only first level parent
                  attachParentLocationDetails(
                    `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']}`,
                    propertyName,
                    propertyName
                  );
                }
              }
            }

            // finished
            sheetHandler.excel.worksheet.columns = sheetHandler.columns.headerColumns;
          });
      };

      // determine next batch of rows that we need to export
      const determineBatchOfRecordsToExport = (batchSize) => {
        return temporaryCollection
          .find(
            {}, {
              limit: batchSize,
              projection: {
                _id: 1,
                rowId: 1
              }
            }
          )
          .toArray();
      };

      // retrieve batch of rows to export
      const retrieveBatchToExport = (records) => {
        // do we have something to retrieve ?
        records = records || [];
        const rowIdsToRetrieve = records.map((record) => record.rowId);
        return records.length < 1 ?
          [] :
          (exportDataCollection
            .find({
              _id: {
                $in: rowIdsToRetrieve
              }
            }, {
              projection: sheetHandler.projection
            })
            .toArray()
            .then((recordsToExport) => {
              // delete records from temporary collection so we don't export them again
              return temporaryCollection
                .deleteMany({
                  _id: {
                    $in: records.map((record) => record._id)
                  }
                })
                .then(() => {
                  // finished
                  return recordsToExport;
                });
            }));
      };

      // retrieve data like missing tokens ...
      // all locations should've been retrieved above - location initialization
      const writeDataToFileDetermineMissingData = (records) => {
        // retrieve missing data
        // faster than a zombie
        const missingData = {
          tokens: {}
        };
        for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
          // get record data
          const record = records[recordIndex];
          sheetHandler.columns.headerColumns.forEach((column) => {
            // do we have a formula ?
            let cellValue;
            if (column.formula) {
              // retrieve result from formula
              cellValue = column.formula(
                _.get(record, column.path)
              );
            } else {
              // determine value from column path
              cellValue = _.get(
                record,
                column.path
              );
            }

            // check if we have missing tokens, locations ...
            if (
              cellValue &&
              typeof cellValue === 'string'
            ) {
              // missing token ?
              if (cellValue.startsWith('LNG_')) {
                if (!sheetHandler.dictionaryMap[cellValue]) {
                  missingData.tokens[cellValue] = true;
                }
              }
            }
          });
        }

        // finished
        return missingData;
      };

      // handle write data to file
      const writeDataToFile = (records) => {
        // determine missing data like tokens, locations, ...
        const missingData = writeDataToFileDetermineMissingData(records);

        // retrieve necessary data & write record to file
        return Promise.resolve()
          // retrieve missing language tokens & write data
          .then(() => {
            // no missing tokens ?
            if (_.isEmpty(missingData.tokens)) {
              return;
            }

            // retrieve missing tokens
            return retrieveMissingTokens(
              sheetHandler.languageId,
              Object.keys(missingData.tokens)
            );
          })

          // write row to file
          .then(() => {
            // write data to file
            // for faster then forEach :) - monumental gain :)
            for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
              // get record data
              const record = records[recordIndex];

              // convert geo-points (if any)
              covertAddressesGeoPointToLoopbackFormat(record);

              // go through data and add create data array taking in account columns order
              const data = [];
              sheetHandler.columns.headerColumns.forEach((column) => {
                // do we have a formula ?
                let cellValue;
                if (column.formula) {
                  cellValue = column.formula(
                    _.get(record, column.path)
                  );
                } else {
                  // determine value from column path
                  cellValue = _.get(
                    record,
                    column.path
                  );

                  // need to replace location id with location name ?
                  if (
                    cellValue &&
                    typeof cellValue === 'string' &&
                    sheetHandler.columns.locationsFieldsMap[column.pathWithoutIndexes]
                  ) {
                    cellValue = sheetHandler.locationsMap[cellValue] ?
                      sheetHandler.locationsMap[cellValue].name :
                      cellValue;
                  }
                }

                // process data applies for all
                // - formulas & values
                if (cellValue) {
                  // translate
                  if (
                    typeof cellValue === 'string' &&
                    cellValue.startsWith('LNG_')
                  ) {
                    cellValue = sheetHandler.dictionaryMap[cellValue] !== undefined ?
                      sheetHandler.dictionaryMap[cellValue] :
                      cellValue;
                  }

                  // format dates
                  if (cellValue instanceof Date) {
                    cellValue = moment(cellValue).toISOString();
                  }
                }

                // add value to row
                data.push(cellValue);
              });

              // append row
              sheetHandler.excel.worksheet.addRow(data).commit();
            }

            // update export log
            sheetHandler.processedNo += records.length;
            return sheetHandler.updateExportLog({
              processedNo: sheetHandler.processedNo,
              updatedAt: new Date()
            });
          });
      };

      // process data in batches
      return handleActionsInBatches(
        () => {
          // create export log entry
          return initializeExportLog()
            // retrieve general language tokens
            .then(initializeLanguageTokens)

            // change export status => Preparing records
            .then(() => {
              return sheetHandler.updateExportLog({
                statusStep: 'LNG_STATUS_STEP_PREPARING_RECORDS',
                updatedAt: new Date()
              });
            })

            // generate temporary collection - view
            .then(initializeCollectionView)

            // change export status => Preparing locations
            .then(() => {
              return sheetHandler.updateExportLog({
                statusStep: 'LNG_STATUS_STEP_PREPARING_LOCATIONS',
                updatedAt: new Date()
              });
            })

            // retrieve locations
            .then(initializeLocations)

            // change export status => Preparing column headers
            .then(() => {
              return sheetHandler.updateExportLog({
                statusStep: 'LNG_STATUS_STEP_CONFIGURE_HEADERS',
                updatedAt: new Date()
              });
            })

            // generate column headers
            .then(initializeColumns)

            // count number of records that we need to export
            .then(() => {
              return temporaryCollection.countDocuments();
            })
            .then((counted) => {
              // change export status => Starting to export data
              return sheetHandler.updateExportLog(
                {
                  totalNo: counted,
                  statusStep: 'LNG_STATUS_STEP_EXPORTING_RECORDS',
                  updatedAt: new Date()
                })
                .then(() => {
                  // start the actual exporting of data
                  return counted;
                });
            });
        },
        (batchNo, batchSize) => {
          // get row records that we need to export from temporary collection
          // order is natual, which should be the order they were added on, so basically aggregate $sort order - resulting in order from client
          return determineBatchOfRecordsToExport(batchSize)
            .then(retrieveBatchToExport);
        },
        writeDataToFile,
        null,
        sheetHandler.batchSize,
        0,
        console
      );
    })
    .then(() => {
      // should've exported all records - redundant but better check
      return temporaryCollection
        .countDocuments()
        .then((counted) => {
          if (counted > 0) {
            throw new Error('Not all documents were exported');
          }
        });
    })
    .then(() => {
      // finished with temporary workbook file
      return sheetHandler.excel.workbook.commit();
    })
    .then(() => {
      // drop temporary collection since we finished the export and we don't need it anymore
      return dropTemporaryCollection();
    })
    .then(() => {
      // drop temporary collection & file on api restart
      // #TODO

      // finished exporting data
      return sheetHandler.updateExportLog({
        status: 'LNG_SYNC_STATUS_SUCCESS',
        statusStep: 'LNG_STATUS_STEP_EXPORT_FINISHED',
        updatedAt: new Date(),
        actionCompletionDate: new Date()
      });
    })
    .then(() => {
      // finished - stop worker
      parentCallback(null, {
        subject: 'KILL'
      });
    })
    .catch((err) => {
      sheetHandler.updateExportLog(
        {
          status: 'LNG_SYNC_STATUS_FAILED',
          // statusStep - keep as it is because it could help to know where it failed, on what step
          error: err.message,
          errStack: err.stack,
          updatedAt: new Date()
        })

        // remove temporary collection if it was created ?
        .then(dropTemporaryCollection)

        // remove file if generated
        // #TODO

        // update export log to contain errors
        .then(() => {
          // throw parent error
          parentCallback(err);
        })
        .catch(() => {
          // throw parent error
          parentCallback(err);
        });
    });
}

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
  return !visualId ? visualId : visualId
    .replace(/YYYY/g, moment().format('YYYY'))
    .replace(/\*/g, '');
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

Object.assign(module.exports, {
  getDate: getDate,
  streamToBuffer: streamUtils.streamToBuffer,
  remapProperties: remapProperties,
  getDateEndOfDay: getDateEndOfDay,
  getAsciiString: getAsciiString,
  getChunksForInterval: getChunksForInterval,
  convertPropsToDate: convertPropsToDate,
  isValidDate: isValidDate,
  extractImportableFields: extractImportableFields,
  extractImportableFieldsNoModel: extractImportableFieldsNoModel,
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
  translateQuestionAnswers: translateQuestionAnswers,
  getBuildInformation: getBuildInformation,
  getModelBooleanProperties: getModelBooleanProperties,
  convertBooleanProperties: convertBooleanProperties,
  convertBooleanPropertiesNoModel: convertBooleanPropertiesNoModel,
  getSourceAndTargetFromModelHookContext: getSourceAndTargetFromModelHookContext,
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
  convertQuestionStringDatesToDates: convertQuestionStringDatesToDates,
  convertQuestionAnswerToOldFormat: convertQuestionAnswerToOldFormat,
  convertQuestionnaireAnswersToOldFormat: convertQuestionnaireAnswersToOldFormat,
  convertQuestionnaireAnswersToNewFormat: convertQuestionnaireAnswersToNewFormat,
  retrieveQuestionnaireVariables: retrieveQuestionnaireVariables,
  getDateChunks: getDateChunks,
  getDaysSince: getDaysSince,
  getQuestionnaireMaxAnswersMap: getQuestionnaireMaxAnswersMap,
  convertQuestionnairePropsToDate: convertQuestionnairePropsToDate,
  getFilterCustomOption: getFilterCustomOption,
  attachLocations: attachLocations,
  removeFilterOptions: removeFilterOptions,
  attachCustomDeleteFilterOption: attachCustomDeleteFilterOption,
  getMaximumLengthForArrays: getMaximumLengthForArrays,
  getCaptchaConfig: getCaptchaConfig,
  handleActionsInBatches: handleActionsInBatches,
  exportFilteredModelsList: exportFilteredModelsList,
  extractVariablesAndAnswerOptions: extractVariablesAndAnswerOptions,
  sanitizePersonAddresses: sanitizePersonAddresses,
  sanitizePersonVisualId: sanitizePersonVisualId,
  processMapLists: processMapLists,
  remapPropertiesUsingProcessedMap: remapPropertiesUsingProcessedMap,
  getDuplicateKey,
  attachDuplicateKeys
});
