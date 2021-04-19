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
 * TODO: Duplicated from above; Current change consists in using another function for xlsx export
 * Export a list in a file (synchronously)
 * @param headers file list headers
 * @param dataSet {Array} actual data set
 * @param fileType {enum} [json, xml, csv, xls, xlsx, ods, pdf]
 * @return {Promise<any>}
 */
const exportListFileSyncNew = function (headers, dataSet, fileType, title = 'List') {

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
        spreadSheetFile
          .createAndSaveXlsxFile(
            // map headers for exceljs format
            headers.map(header => {
              header.key = header.id;
              delete header.id;
              return header;
            }),
            dataSet.map(item => getFlatObject(item, null, true)))
          .then(filename => {
            file.name = filename;
            resolve(file);
          })
          .catch(reject);
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
 * TODO: Duplicated functionality from above without using Loopback models and app
 * Resolve foreign keys for a model in a result set (this includes reference data)
 * @param options Container for foreignKeyResolverMap and referenceDataFields
 * @param resultSet
 * @param languageDictionary
 * @param [resolveReferenceData]
 * @return {Promise<any>}
 */
const resolveModelForeignKeysNoModels = function (options, resultSet, languageDictionary, resolveReferenceData) {

  // by default also resolve reference data
  if (resolveReferenceData === undefined) {
    resolveReferenceData = true;
  }

  // promisify the response
  return new Promise(function (resolve, reject) {

    // build a list of queries (per model) in order to resolve foreign keys
    const foreignKeyQueryMap = {};
    // container for model projection for MongoDB query
    const foreignKeyProjectionMap = {};

    // map model name to collection name
    const modelToCollectionMap = {};

    // keep a flag for resolving foreign keys
    let resolveForeignKeys = false;

    // if the model has a resolver map
    if (options.foreignKeyResolverMap) {
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
        Object.keys(options.foreignKeyResolverMap).forEach(function (foreignKey) {
          let foreignKeyInfo = options.foreignKeyResolverMap[foreignKey];

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
              modelName: foreignKeyInfo.modelName,
              key: foreignKey,
              value: foreignKeyValue.value,
              useProperty: foreignKeyInfo.useProperty
            };
            // update the query map with the data that needs to be queried
            if (!foreignKeyQueryMap[foreignKeyInfo.modelName]) {
              foreignKeyQueryMap[foreignKeyInfo.modelName] = [];

              foreignKeyProjectionMap[foreignKeyInfo.modelName] = {};

              // map MongoDB collection name to model name
              modelToCollectionMap[foreignKeyInfo.modelName] = foreignKeyInfo.collectionName;
            }
            foreignKeyQueryMap[foreignKeyInfo.modelName].push(foreignKeyValue.value);
            foreignKeyProjectionMap[foreignKeyInfo.modelName][foreignKeyInfo.useProperty] = 1;
          });
        });
      }

      // also resolve reference data if needed
      if (resolveReferenceData) {
        translateDataSetReferenceDataValues(result, options.referenceDataFields, languageDictionary);
      }
    });

    if (resolveForeignKeys) {
      // build a list of queries that will be executed to resolve foreign keys
      const queryForeignKeys = {};
      // go through the entries in the query map
      Object.keys(foreignKeyQueryMap).forEach(function (modelName) {
        // add query operation (per model name)
        queryForeignKeys[modelName] = function (callback) {
          MongoDBHelper.executeAction(
            modelToCollectionMap[modelName],
            'find',
            [
              {
                _id: {
                  $in: foreignKeyQueryMap[modelName]
                },
                deleted: {
                  $ne: true
                }
              },
              {
                projection: foreignKeyProjectionMap[modelName]
              }
            ])
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
const includeSubLocationsInLocationFilter = function (app, filter, callback) {
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
              filter[propertyName.replace('parentLocationIdFilter', 'locationId')] = {
                [inqKey]: locationIds
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
 * Attach locations data (id, identifiers and parent locations) for each of the target model locations
 * @param locationFields Array of references to records location fields
 * @param records
 */
const attachLocationsNoModels = function (locationFields, records) {
  if (!locationFields || !locationFields.length) {
    // no location fields for which to get parents
    return Promise.resolve({records});
  }

  // location fields suffixes
  const locationUIDSuffix = '_uid';
  const locationIdentifiersSuffix = '_identifiers';
  const parentLocationsSuffix = '_parentLocations';

  // get all the location ids from all the passed records
  const allLocations = [];
  const recordsLocationsMap = {};
  for (let record of records) {
    recordsLocationsMap[record.id] = [];
    for (let field of (locationFields || [])) {
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
    return Promise.resolve({records});
  }

  return new Promise((resolve, reject) => {
    return getParentLocationsWithDetails(
      allLocations,
      [],
      {
        fields: ['name', 'parentLocationId', 'geographicalLevelId', 'identifiers']
      },
      (err, locations) => {
        if (err) {
          return reject(err);
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

            if (parentLocations.length > highestParentsChain) {
              highestParentsChain = parentLocations.length;
            }

            // add the location uid
            _.set(record, `${obj.exactPath}${locationUIDSuffix}`, obj.value);

            // add the location identifiers codes
            let identifiers = [];
            if (
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
        return resolve({records, highestIdentifiersChain, highestParentsChain});
      }
    );
  });
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
 * @return {*|PromiseLike<T | never | never>|Promise<T | never | never>}
 */
const handleActionsInBatches = function (
  getActionsCount,
  getBatchData,
  batchItemsAction,
  itemAction,
  batchSize,
  parallelActionsNo,
  logger
) {
  return getActionsCount()
    .then(actionsCount => {
      if (actionsCount === 0) {
        // nothing to do
        logger.debug('No data found for which to execute actions');
        return Promise.resolve();
      }

      let totalBatchesNo = Math.ceil(actionsCount / batchSize);
      logger.debug(`Actions to be done: ${actionsCount}. Batches: ${totalBatchesNo}`);

      /**
       * Handle batchNo of actions
       * @param batchNo
       * @return {PromiseLike<T | never>}
       */
      const handleBatch = (batchNo = 1) => {
        logger.debug(`Processing batch ${batchNo} of ${totalBatchesNo}`);

        return getBatchData(batchNo, batchSize)
          .then(dataArray => {
            // do we need to execute action for all batch data ?
            if (!batchItemsAction) {
              return dataArray;
            }

            // execute batch group promise
            return batchItemsAction(dataArray)
              .then(() => {
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
            logger.debug(`Finished processing batch ${batchNo} of ${totalBatchesNo}`);
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
      return handleBatch();
    });
};

/**
 * Export filtered model list
 * @param modelOptions Options for the model that will be exported
 * @param modelPropertiesExpandOnFlatFiles Headers for custom fields like questionnaireAnswers
 * @param query
 * @param exportType
 * @param encryptPassword {string|null}
 * @param anonymizeFields
 * @param exportFieldsGroup
 * @param options
 */
function exportFilteredModelsList(
  modelOptions,
  modelPropertiesExpandOnFlatFiles,
  query,
  exportType,
  encryptPassword,
  anonymizeFields,
  exportFieldsGroup,
  options
) {
  query = query || {};

  let modelPropertiesExpandOnFlatFilesKeys = [];

  // get fields that need to be exported from model options
  const fieldLabelsMap = modelOptions.sanitizeFieldLabelsMapForExport ? modelOptions.sanitizeFieldLabelsMapForExport() : modelOptions.fieldLabelsMap;

  // get the fields order
  let exportFieldsOrder = modelOptions.exportFieldsOrder ? [...modelOptions.exportFieldsOrder] : [];

  // check if location id and location identifiers custom fields should be removed
  let addLocationUID = true;
  let addLocationIdentifiers = true;

  if (
    exportFieldsGroup.length &&
    modelOptions.exportFieldsGroup
  ) {
    // mapping
    const exportFieldsGroupMap = {};

    // map the export fields map
    _.each(modelOptions.exportFieldsGroup, (fieldsGroup, token) => {
      if (fieldsGroup.properties) {
        _.each(fieldsGroup.properties, (property) => {
          exportFieldsGroupMap[property] = token;
        });
      }
    });

    // check if location id and identifiers must be added in the file
    if (exportFieldsGroup.includes('LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA') &&
      modelOptions.exportFieldsGroup['LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA'] &&
      modelOptions.exportFieldsGroup['LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA']['properties']
    ) {
      addLocationUID = modelOptions.exportFieldsGroup['LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA']['properties'].includes('uid');
      addLocationIdentifiers = modelOptions.exportFieldsGroup['LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA']['properties'].includes('identifiers');
    } else {
      addLocationUID = false;
      addLocationIdentifiers = false;
    }

    // exclude the fields that are not in the export fields group
    _.each(fieldLabelsMap, (token, property) => {
      if (
        exportFieldsGroupMap[property] &&
        !exportFieldsGroup.includes(exportFieldsGroupMap[property])
      ) {
        delete fieldLabelsMap[property];

        // exclude from Model.exportFieldsOrder also
        if (exportFieldsOrder.length) {
          exportFieldsOrder = exportFieldsOrder.filter(item => item !== property);
        }
      }
    });
  }

  // some models may have a specific order for headers
  let originalFieldsList = Object.keys(fieldLabelsMap);
  let fieldsList = [];
  if (exportFieldsOrder) {
    fieldsList = [...exportFieldsOrder];
    // sometimes the order list contains only a subset of the actual fields list
    if (exportFieldsOrder.length !== originalFieldsList.length) {
      fieldsList.push(...originalFieldsList.filter(f => exportFieldsOrder.indexOf(f) === -1));
    }
  } else {
    fieldsList = [...originalFieldsList];
  }

  // create results projection from fieldsList
  let resultsProjection = {};
  fieldsList.forEach(fieldRef => {
    // get property projection by getting the first part of the fieldRef until a '.' or '[' is encountered
    let propProjection = fieldRef.split(/[.\[]/g)[0];
    if (!resultsProjection[propProjection]) {
      resultsProjection[propProjection] = 1;
    }
  });

  // initialize flag to know that model has array props defined separately
  const arrayPropsDefined = !!modelOptions.arrayProps;

  // cache results
  let results;

  // cache dictionary
  let dictionary;

  // get records
  let getRecordsPromise;
  // in some cases records might come from the calling function
  if (options.records) {
    getRecordsPromise = Promise.resolve(options.records);
  } else {
    // check for additional scope query that needs to be added
    if (modelOptions.scopeQuery) {
      query = mergeFilters(query, modelOptions.scopeQuery);
    }

    // check for deleted flag; by default all items will be retrieved including deleted
    if (!query.deleted) {
      query = mergeFilters(query, {
        where: {
          deleted: {
            ne: true
          }
        }
      });
    }

    // get MongoDB query options from Loopback filter
    let mongoDBOptions = MongoDBHelper.getMongoDBOptionsFromLoopbackFilter(query);
    getRecordsPromise = MongoDBHelper.executeAction(
      modelOptions.collectionName,
      'find',
      [
        mongoDBOptions.where,
        {
          projection: resultsProjection
        }
      ]
    );
  }

  return getRecordsPromise
    .then(res => {
      // cache results
      results = res;

      // get dictionary for required headers
      let tokensQuery = {};
      // start with model fields
      let neededTokens = Object.values(fieldLabelsMap);
      // all tokens from arrayProps
      if (arrayPropsDefined) {
        Object.values(modelOptions.arrayProps).forEach(arrayPropMap => {
          neededTokens.push(...Object.values(arrayPropMap));
        });
      }

      // location data tokens
      neededTokens.push(
        'LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL',
        'LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION',
        'LNG_LOCATION_FIELD_LABEL_ID',
        'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS',
        'LNG_LOCATION_FIELD_LABEL_IDENTIFIER');

      // referenceDataFields categories and allowed values
      if (modelOptions.referenceDataFieldsToCategoryMap) {
        let refDataValuesRegex = '';

        Object.values(modelOptions.referenceDataFieldsToCategoryMap).forEach(refCategory => {
          // retrieve category
          neededTokens.push(refCategory);

          // add to allowed values regex
          refDataValuesRegex += refDataValuesRegex.length ? `|${refCategory}` : refCategory;
        });

        if (refDataValuesRegex.length) {
          // add regex to query
          tokensQuery['$or'] = [{
            token: {
              $regex: `^${refDataValuesRegex}`
            }
          }];
        }
      }

      // parse questionnaire to get headers and tokens that need to be retrieved
      let parsedQuestionnaire;
      // TODO: loops through all records
      if (!modelPropertiesExpandOnFlatFiles.questionnaireAnswers && options.questionnaire && options.questionnaire.length) {
        parsedQuestionnaire = getQuestionnaireVariablesMapping(
          options.questionnaire,
          'questionnaireAnswers',
          options.useQuestionVariable,
          // get max number of answers for each questionnaire question
          getQuestionnaireMaxAnswersMapNew(options.questionnaire, results)
        );

        modelPropertiesExpandOnFlatFiles.questionnaireAnswers = parsedQuestionnaire.questionsList;

        // add the questionnaire tokens in neededTokens
        neededTokens.push(...Object.keys(parsedQuestionnaire.tokensToQuestionsMap));
      }

      // complete the tokens query with the needed tokens
      // Note: No need to split the $in query to prevent MongoDB query size limit error as there would need to be more than 20000 tokens queried which is not the case
      if (tokensQuery['$or']) {
        tokensQuery['$or'].push({
          token: {
            $in: [...new Set(neededTokens)]
          }
        });
      } else {
        tokensQuery.token = {
          $in: [...new Set(neededTokens)]
        };
      }

      // load user language dictionary
      return baseLanguageModel.helpers
        .getLanguageDictionary(options.contextUserLanguageId, tokensQuery)
        .then(res => {
          // cache dictionary
          dictionary = res;

          // add translations to questionnaire headers if needed
          if (
            parsedQuestionnaire &&
            parsedQuestionnaire.tokensToQuestionsMap
          ) {
            // get token translation placeholder
            const translationPlaceholder = parsedQuestionnaire.translationPlaceholder;

            // loop through tokens
            for (let token in parsedQuestionnaire.tokensToQuestionsMap) {
              // get translation
              let tokenTranslation = dictionary.getTranslation(token);

              // get token map
              let tokenMap = parsedQuestionnaire.tokensToQuestionsMap[token];

              // loop through questions for token
              for (let questionIndex in tokenMap) {
                let propsToReplace = tokenMap[questionIndex];

                // loop through props to replace
                for (let prop in propsToReplace) {
                  // replace props values with the calculated one for the translation
                  _.set(modelPropertiesExpandOnFlatFiles.questionnaireAnswers, `${questionIndex}.${prop}`, propsToReplace[prop].replace(translationPlaceholder, tokenTranslation));
                }
              }
            }
          }
        });
    })
    .then(() => {
      // convert geo-points (if any)
      results.forEach(function (result) {
        covertAddressesGeoPointToLoopbackFormat(result);
      });

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

      const isJSONXMLExport = ['json', 'xml'].includes(exportType);

      // calculate maximum number of elements for array props
      // do this only if export type is flat
      // TODO: loops through all records
      let arrayPropsLengths = null;
      if (!isJSONXMLExport && arrayPropsDefined) {
        arrayPropsLengths = getMaximumLengthForArrays(results, Object.keys(modelOptions.arrayProps));
      }

      return attachLocationsNoModels(
        modelOptions.locationFields,
        results)
        .then(result => {
          let highestParentsChain = 0;
          result = result || {};
          results = result.records || results;
          highestParentsChain = result.highestParentsChain || 0;

          // get the maximum number of location identifiers
          const highestIdentifiersChain = result.highestIdentifiersChain || 0;

          // define a list of table headers
          const headers = [];

          // loop through the fields list to construct headers
          fieldsList.forEach(function (propertyName) {
            // new functionality, not supported by all models
            // if model has array props defined and we need to export a flat file construct headers for all elements in array props
            if (!isJSONXMLExport && arrayPropsDefined) {
              if (modelOptions.arrayProps[propertyName]) {
                // determine if we need to include parent token
                const parentToken = fieldLabelsMap[propertyName];

                // array properties map
                const map = modelOptions.arrayProps[propertyName];

                // create headers
                let maxElements = arrayPropsLengths[propertyName];
                // pdf has a limited width, include only one element
                if (exportType === 'pdf') {
                  maxElements = 1;
                }
                for (let i = 1; i <= maxElements; i++) {
                  for (let prop in map) {
                    // remove "." from the property name
                    const propName = prop.replace(/\./g, ' ');

                    headers.push({
                      id: `${propertyName} ${i} ${propName}`,
                      // use correct label translation for user language
                      header: `${parentToken ? dictionary.getTranslation(parentToken) + ' ' : ''}${dictionary.getTranslation(map[prop])} [${i}]`
                    });

                    // check if we need to include additional location columns (id, identifiers and parent location)
                    if (
                      modelOptions.locationFields &&
                      modelOptions.locationFields.indexOf(`${propertyName}[].${prop}`) !== -1
                    ) {
                      // include the location id as a new column because the original location id will be replaced with the location name
                      if (addLocationUID) {
                        headers.push({
                          id: `${propertyName} ${i} ${propName}_uid`,
                          // use correct label translation for user language
                          header: `${parentToken ? dictionary.getTranslation(parentToken) + ' ' : ''}${dictionary.getTranslation(map[prop])} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_ID')} [${i}]`
                        });
                      }

                      // include the location identifiers codes
                      if (addLocationIdentifiers) {
                        for (let j = 1; j <= highestIdentifiersChain; j++) {
                          headers.push({
                            id: `${propertyName} ${i} ${propName}_identifiers ${j}`,
                            // use correct label translation for user language
                            header: `${parentToken ? dictionary.getTranslation(parentToken) + ' ' : ''}${dictionary.getTranslation(map[prop])} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_IDENTIFIERS')} [${i}] ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_IDENTIFIER')} [${j}]`
                          });
                        }
                      }

                      // include the parent locations columns
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

              if (propertyName.endsWith('[]') && modelOptions.arrayProps[propertyName.replace('[]', '')]) {
                const tmpPropertyName = propertyName.replace('[]', '');
                // array with primitive values
                let maxElements = arrayPropsLengths[tmpPropertyName];
                // pdf has a limited width, include only one element
                if (exportType === 'pdf') {
                  maxElements = 1;
                }
                for (let i = 1; i <= maxElements; i++) {
                  headers.push({
                    id: propertyName.replace('[]', ` ${i}`).replace(/\./g, ' '),
                    header: `${dictionary.getTranslation(fieldLabelsMap[propertyName])} [${i}]`
                  });
                }
                return;
              }
            }

            // do not handle array properties from field labels map when we have arrayProps set on the model
            if (!isJSONXMLExport && propertyName.indexOf('[]') > -1 && arrayPropsDefined) {
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

                // check if we need to include additional location columns (UID, identifiers and parent location)
                if (
                  modelOptions.locationFields &&
                  modelOptions.locationFields.indexOf(propertyName) !== -1
                ) {
                  // include the location id as a new column because the original location id will be replaced with the location name
                  if (addLocationUID) {
                    headers.push({
                      id: `${propertyName}_uid`,
                      header: `${headerTranslation} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_ID')}`
                    });
                  }

                  // include the location identifiers and parent locations columns
                  if (isJSONXMLExport) {
                    // include the location identifiers codes
                    if (addLocationIdentifiers) {
                      headers.push({
                        id: `${propertyName}_identifiers`,
                        header: `${headerTranslation} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_IDENTIFIERS')}`
                      });
                    }

                    headers.push({
                      id: `${propertyName}_parentLocations`,
                      header: `${headerTranslation} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION')}`
                    });
                  } else {
                    if (addLocationIdentifiers) {
                      for (let i = 1; i <= highestIdentifiersChain; i++) {
                        headers.push({
                          id: `${propertyName.replace(/\./g, ' ')}_identifiers ${i}`,
                          header: `${headerTranslation} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_IDENTIFIERS')} ${dictionary.getTranslation('LNG_LOCATION_FIELD_LABEL_IDENTIFIER')} [${i}]`
                        });
                      }
                    }

                    for (let i = 1; i <= highestParentsChain; i++) {
                      headers.push({
                        id: `${propertyName.replace(/\./g, ' ')}_parentLocations ${i}`,
                        header: `${headerTranslation} ${dictionary.getTranslation('LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL')} [${i}]`
                      });
                    }
                  }
                }
              }
            }
          });

          // resolve model foreign keys (if any)
          return resolveModelForeignKeysNoModels({
            foreignKeyResolverMap: modelOptions.foreignKeyResolverMap,
            referenceDataFields: modelOptions.referenceDataFields
          }, results, dictionary)
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
                anonymizeDatasetFields.anonymize(results, anonymizeFields);
              }
              return results;
            })
            .then(function (results) {
              // create file with the results
              return exportListFileSyncNew(headers, results, exportType);
            })
            .then(function (file) {
              if (file.name) {
                // read file
                file.data = fs.readFileSync(file.name);
              }

              if (encryptPassword) {
                return aesCrypto.encrypt(encryptPassword, file.data)
                  .then(function (data) {
                    file.data = data;
                    return file;
                  });
              } else {
                return file;
              }
            });
        });
    });
}

/**
 * TODO: Duplicated from getQuestionnaireMaxAnswersMap; Should replace the usages considering the below note
 * Note: Removed translationOpts logic as it was only used for importable files and affected performance of this function
 * Loop through the records and get max answers number for multi date answer questions
 * @param questionnaire
 * @param records
 * @returns {{}}
 */
function getQuestionnaireMaxAnswersMapNew(questionnaire, records) {
  /**
   * Parse questions and fill map for multi date questions
   * @param questions
   * @param map
   * @returns {{}}
   */
  function parseQuestions(questions, map) {
    if (!Array.isArray(questions)) {
      questions = [questions];
    }

    questions.forEach((question => {
      // initialize max number of answers for question to 0
      map[question.variable] = 0;
      (question.answers || []).forEach(answer => (answer.additionalQuestions && parseQuestions(answer.additionalQuestions, map)));
    }));
  }

  // check if we have data
  if (
    !questionnaire ||
    !questionnaire.length
  ) {
    // nothing to add in map
    return {};
  }

  // initialize a map of all the multi date answer questions and their nested questions
  let multiDatequestionsList = {};

  // loop through the questionnaire and fill the multiDatequestionsList
  (questionnaire || []).forEach(q => {
    if (!q.multiAnswer) {
      return;
    }

    // fill the multi date questions map
    parseQuestions(q, multiDatequestionsList);
  });

  // get multi date questions identifiers
  let multiDateQuestions = Object.keys(multiDatequestionsList);

  // answers property on records
  const propToIterate = 'questionnaireAnswers';

  // get maximum number of multi date answers
  records.forEach(record => {
    if (!record[propToIterate]) {
      // it doesn't have any questions, skip it
      return;
    }

    // loop through the multi date questions as they are usually in less number than the record questionnaire answers
    multiDateQuestions.forEach(q => {
      if (!record[propToIterate][q]) {
        return;
      }

      // check if record has a bigger number of answers than current max
      if (multiDatequestionsList[q] < record[propToIterate][q].length) {
        // new highest number of answers
        multiDatequestionsList[q] = record[propToIterate][q].length;
      }
    });
  });

  return multiDatequestionsList;
}

/**
 * Retrieve list of questionnaire questions and their variables
 * @param questionnaire List of questions
 * @param idHeaderPrefix Prefix for ID
 * @param useVariable Flag specifying whether the question variable needs to be used of we need to get tokens translation
 * @param multiDateLengthsMap Map of questions with multi date answers to max number of answers in the dataset
 * @param questionsList List of questions with info; Will be updated in the function
 * @param tokensToQuestionsMap Map of tokens to questions index in questions list; This map is filled in the function if useVariable is false
 * @param isNestedMultiDate Flag specifying if the questionnaire received is nested in another question
 * @param multiDateIndex Index for multi date answer
 * @returns {{}|{translationPlaceholder: string, questionsList: *[], tokensToQuestionsMap: {}}}
 */
function getQuestionnaireVariablesMapping(questionnaire, idHeaderPrefix, useVariable, multiDateLengthsMap, questionsList, tokensToQuestionsMap, isNestedMultiDate, multiDateIndex) {
  if (_.isEmpty(questionnaire)) {
    return {};
  }

  // initialize list of questions with info if not received
  if (!questionsList) {
    questionsList = [];
  }

  // initialize map of tokens to questions indexes in questionsList if not received
  if (!tokensToQuestionsMap) {
    tokensToQuestionsMap = {};
  }

  // initialize translation placeholder to be used in questions props values for the ones that need translation
  const translationPlaceholder = '%%translation%%';

  _.each(questionnaire, (question) => {
    // markup questions
    if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP') {
      let index = questionsList.push({
        expandKey: question.variable,
        expandHeader: question.variable,
        id: (idHeaderPrefix ? idHeaderPrefix + ' ' : '') + question.variable,
        header: question.variable
      }) - 1;

      if (!useVariable) {
        // we should use translations; cache in map of tokens to be translated
        if (!tokensToQuestionsMap[question.text]) {
          tokensToQuestionsMap[question.text] = {
            [index]: {
              // properties to be updated for index
              // use translation placeholder to know what value should be added after tokens are retrieve from DB
              'expandHeader': translationPlaceholder,
              'header': translationPlaceholder
            }
          };
        } else {
          tokensToQuestionsMap[question.text][index] = {
            'expandHeader': translationPlaceholder,
            'header': translationPlaceholder
          };
        }
      }

      return;
    }

    // no need to to any checks when the variable is missing
    if (_.isEmpty(question.variable)) {
      return;
    }

    // check for multi date questions
    const isMultiDate = question.multiAnswer || isNestedMultiDate;
    multiDateLengthsMap[question.variable] = multiDateLengthsMap[question.variable] || 0;

    // multiple answers questions
    if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
      // for multiple answers questions we need answers
      // nothing to do if none are defined
      if (_.isEmpty(question.answers)) {
        return;
      }

      if (isMultiDate) {
        // multi date answers
        const addQuestionAndAnswers = (multiDateIndex) => {
          _.each(question.answers, (answer, answerIndex) => {
            let index = questionsList.push({
              id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} date`,
              header: `${question.variable} [MD ${multiDateIndex}]`
            }) - 1;

            if (!useVariable) {
              // we should use translations; cache in map of tokens to be translated
              if (!tokensToQuestionsMap[question.text]) {
                tokensToQuestionsMap[question.text] = {
                  [index]: {
                    // properties to be updated for index
                    // use translation placeholder to know what value should be added after tokens are retrieve from DB
                    'header': `${translationPlaceholder} [MD ${multiDateIndex}]`
                  }
                };
              } else {
                tokensToQuestionsMap[question.text][index] = {
                  'header': `${translationPlaceholder} [MD ${multiDateIndex}]`
                };
              }
            }

            index = questionsList.push({
              expandKey: question.variable,
              expandHeader: question.variable,
              id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} value ${(answerIndex + 1)}`,
              header: `${question.variable} ${(answerIndex + 1)} [MV ${multiDateIndex}]`
            }) - 1;

            if (!useVariable) {
              // we should use translations; cache in map of tokens to be translated
              if (!tokensToQuestionsMap[question.text]) {
                tokensToQuestionsMap[question.text] = {
                  [index]: {
                    // properties to be updated for index
                    // use translation placeholder to know what value should be added after tokens are retrieve from DB
                    'expandHeader': translationPlaceholder,
                    'header': `${translationPlaceholder} ${(answerIndex + 1)} [MV ${multiDateIndex}]`
                  }
                };
              } else {
                tokensToQuestionsMap[question.text][index] = {
                  'expandHeader': translationPlaceholder,
                  'header': `${translationPlaceholder} ${(answerIndex + 1)} [MV ${multiDateIndex}]`
                };
              }
            }

            if (!_.isEmpty(answer.additionalQuestions)) {
              // questionsList and tokensToQuestionsMap will be updated in the function
              getQuestionnaireVariablesMapping(
                answer.additionalQuestions,
                idHeaderPrefix,
                useVariable,
                multiDateLengthsMap,
                questionsList,
                tokensToQuestionsMap,
                isMultiDate,
                multiDateIndex
              );
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
        // simple multiple answers questions; no multi date answers
        _.each(question.answers, (answer, answerIndex) => {
          // loop through the answers
          let index = questionsList.push({
            expandKey: question.variable,
            expandHeader: question.variable,
            id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} 1 value ${(answerIndex + 1)}`,
            header: `${question.variable} ${(answerIndex + 1)}`
          }) - 1;

          if (!useVariable) {
            // we should use translations; cache in map of tokens to be translated
            if (!tokensToQuestionsMap[question.text]) {
              tokensToQuestionsMap[question.text] = {
                [index]: {
                  // properties to be updated for index
                  // use translation placeholder to know what value should be added after tokens are retrieve from DB
                  'expandHeader': translationPlaceholder,
                  'header': `${translationPlaceholder} ${(answerIndex + 1)}`
                }
              };
            } else {
              tokensToQuestionsMap[question.text][index] = {
                'expandHeader': translationPlaceholder,
                'header': `${translationPlaceholder} ${(answerIndex + 1)}`
              };
            }
          }

          if (!_.isEmpty(answer.additionalQuestions)) {
            // questionsList and tokensToQuestionsMap will be updated in the function
            getQuestionnaireVariablesMapping(
              answer.additionalQuestions,
              idHeaderPrefix,
              useVariable,
              multiDateLengthsMap,
              questionsList,
              tokensToQuestionsMap,
              isMultiDate,
              multiDateIndex
            );
          }
        });
      }
    } else {
      // no multiple answers question
      if (isMultiDate) {
        // multi date answers question
        const addQuestionAndAnswers = (multiDateIndex) => {
          let index = questionsList.push(
            {
              id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} date`,
              header: `${question.variable} [MD ${multiDateIndex}]`
            }
          ) - 1;

          if (!useVariable) {
            // we should use translations; cache in map of tokens to be translated
            if (!tokensToQuestionsMap[question.text]) {
              tokensToQuestionsMap[question.text] = {
                [index]: {
                  // properties to be updated for index
                  // use translation placeholder to know what value should be added after tokens are retrieve from DB
                  'header': `${translationPlaceholder} [MD ${multiDateIndex}]`
                }
              };
            } else {
              tokensToQuestionsMap[question.text][index] = {
                'header': `${translationPlaceholder} [MD ${multiDateIndex}]`
              };
            }
          }

          index = questionsList.push(
            {
              expandKey: question.variable,
              expandHeader: question.variable,
              id: `${(idHeaderPrefix ? idHeaderPrefix : '')} ${question.variable} ${multiDateIndex} value`,
              header: `${question.variable} [MV ${multiDateIndex}]`
            }
          ) - 1;

          if (!useVariable) {
            // we should use translations; cache in map of tokens to be translated
            if (!tokensToQuestionsMap[question.text]) {
              tokensToQuestionsMap[question.text] = {
                [index]: {
                  // properties to be updated for index
                  // use translation placeholder to know what value should be added after tokens are retrieve from DB
                  'expandHeader': translationPlaceholder,
                  'header': `${translationPlaceholder} [MV ${multiDateIndex}]`
                }
              };
            } else {
              tokensToQuestionsMap[question.text][index] = {
                'expandHeader': translationPlaceholder,
                'header': `${translationPlaceholder} [MV ${multiDateIndex}]`
              };
            }
          }

          // add children questions
          if (!_.isEmpty(question.answers)) {
            _.each(question.answers, (answer) => {
              if (!_.isEmpty(answer.additionalQuestions)) {
                // questionsList and tokensToQuestionsMap will be updated in the function
                getQuestionnaireVariablesMapping(
                  answer.additionalQuestions,
                  idHeaderPrefix,
                  useVariable,
                  multiDateLengthsMap,
                  questionsList,
                  tokensToQuestionsMap,
                  isMultiDate,
                  multiDateIndex
                );
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
        // simple question with simple answer
        let index = questionsList.push({
          expandKey: question.variable,
          expandHeader: question.variable,
          id: (idHeaderPrefix ? idHeaderPrefix + ' ' : '') + question.variable + ' 1 value',
          header: question.variable
        }) - 1;

        if (!useVariable) {
          // we should use translations; cache in map of tokens to be translated
          if (!tokensToQuestionsMap[question.text]) {
            tokensToQuestionsMap[question.text] = {
              [index]: {
                // properties to be updated for index
                // use translation placeholder to know what value should be added after tokens are retrieve from DB
                'expandHeader': translationPlaceholder,
                'header': translationPlaceholder
              }
            };
          } else {
            tokensToQuestionsMap[question.text][index] = {
              'expandHeader': translationPlaceholder,
              'header': translationPlaceholder
            };
          }
        }

        if (!_.isEmpty(question.answers)) {
          _.each(question.answers, (answer) => {
            if (!_.isEmpty(answer.additionalQuestions)) {
              // questionsList and tokensToQuestionsMap will be updated in the function
              getQuestionnaireVariablesMapping(
                answer.additionalQuestions,
                idHeaderPrefix,
                useVariable,
                multiDateLengthsMap,
                questionsList,
                tokensToQuestionsMap,
                isMultiDate,
                multiDateIndex
              );
            }
          });
        }
      }
    }
  });

  return {
    questionsList: questionsList,
    tokensToQuestionsMap: tokensToQuestionsMap,
    translationPlaceholder: translationPlaceholder
  };
}

/**
 * TODO: Duplicated from Locations model in order to not use Loopback models and app
 * Get parent locations for a list of locations. Result is an array of location instances (not Loopback models)
 * Result also includes the models with IDs in locationsIds
 * @param locationsIds Array of location Ids for which to get the parent locations recursively
 * @param allLocations Array on which to add the result; Must be an array of location models
 * @param loopbackFilter Loopback filter; used for projection
 * @param callback
 */
function getParentLocationsWithDetails(locationsIds, allLocations, loopbackFilter, callback) {
  // initialize array of IDs for locations that need to be retrieved
  let locationsToRetrieve = [];

  // retrieve the start locations if the locationIds are not found in the allLocations array
  // also retrieve the parent locations for the locationsIds that are found in allLocations array
  let startLocationsIdsToRetrieve = [];
  let parentLocationsIds = [];

  // create map for allLocations to avoid multiple searches in the array
  let allLocationsMap = {};
  allLocations.forEach(location => {
    allLocationsMap[location.id] = location;
  });

  locationsIds.forEach(function (locationId) {
    if (!allLocationsMap[locationId]) {
      // start location was not found in allLocations array; retrieve it
      startLocationsIdsToRetrieve.push(locationId);
    }
    // start location is already retrieved; retrieve parent if not already in the list
    else if (
      allLocationsMap[locationId].parentLocationId &&
      !allLocationsMap[allLocationsMap[locationId].parentLocationId]
    ) {
      parentLocationsIds.push(allLocationsMap[locationId].parentLocationId);
    }
  });

  // we need to retrieve both the start locations as well as their parents
  locationsToRetrieve = locationsToRetrieve.concat(startLocationsIdsToRetrieve, parentLocationsIds);

  // retrieve locations only if there are IDs missing
  let locationsToRetrievePromise = Promise.resolve([]);
  if (locationsToRetrieve.length) {
    // find not already retrieved locations
    locationsToRetrievePromise = MongoDBHelper.executeAction(
      'location',
      'find',
      [
        // query
        {
          _id: {
            $in: locationsToRetrieve
          },
          // add filter for not deleted entries
          deleted: {
            $ne: true
          }
        },
        // query options
        {
          sort: {
            name: 1
          },
          projection: loopbackFilter.fields ? MongoDBHelper.getMongoDBProjectionFromLoopbackFields(loopbackFilter.fields) : {}
        }
      ]
    );
  }

  // find not already retrieved locations
  locationsToRetrievePromise
    .then(function (locations) {
      // if locations found
      if (locations.length) {
        // initialize array of location IDs for which the parent still needs to be found
        // will be composed of all retrieved locations IDs except the ones for which the parent is already retrieved
        let locationsIdsToRetrieveParent = [];

        locations.forEach(function (location) {
          // get parentLocationId
          let parentLocationId = location.parentLocationId;

          // check if the parent location already exists in allLocations; if so do not retrieve it again.
          if (
            parentLocationId &&
            !allLocationsMap[parentLocationId]
          ) {
            locationsIdsToRetrieveParent.push(location.id);
          }
        });
        // consolidate them in the locations list
        allLocations = allLocations.concat(locations);

        if (locationsIdsToRetrieveParent.length) {
          // go higher into the hierarchy
          getParentLocationsWithDetails(locationsIdsToRetrieveParent, allLocations, loopbackFilter, callback);
        } else {
          // no need to continue searching
          callback(null, allLocations);
        }
      } else {
        // no more locations found, stop here
        callback(null, allLocations);
      }
    })
    .catch(callback);
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
  remapPropertiesUsingProcessedMap: remapPropertiesUsingProcessedMap
});
