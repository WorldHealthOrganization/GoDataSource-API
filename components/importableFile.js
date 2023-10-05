'use strict';

const _ = require('lodash');
const async = require('async');
const fs = require('fs');
const {writeFile} = require('fs/promises');
const path = require('path');
const uuid = require('uuid');
const os = require('os');
const xlsx = require('xlsx');
const excel = require('exceljs');
const sort = require('alphanum-sort');
const tmp = require('tmp');
const admZip = require('adm-zip');
const jsonStream = require('JSONStream');
const es = require('event-stream');
const stream = require('stream');
const csvParse = require('csv-parse').parse;
const util = require('util');
const pipeline = util.promisify(stream.pipeline);
const apiError = require('./apiError');
const helpers = require('./helpers');
const aesCrypto = require('./aesCrypto');
const baseLanguageModel = require('./baseModelOptions/language');
const baseReferenceDataModel = require('./baseModelOptions/referenceData');
const convertLoopbackFilterToMongo = require('./convertLoopbackFilterToMongo');
const MongoDBHelper = require('./mongoDBHelper');
const WorkerRunner = require('./workerRunner');
const localizationHelper = require('./localizationHelper');

// Note: should be kept in sync with the extension used in exportHelper
const zipExtension = '.zip';

const metadataFileSuffix = '_metadata';

// define a list of supported file extensions
const supportedFileExtensions = [
  '.json',
  '.csv',
  '.xls',
  '.xlsx',
  '.ods'
];

// define a list of supported file extensions in zip
const supportedFileExtensionsInZip = [
  '.xls',
  '.xlsx',
  '.ods'
];

// #TODO - ugly hack until new version of excelljs is provided to include fix (4.3.0 didn't include this fix even if code is merged):
// - https://github.com/exceljs/exceljs/pull/1576
// MUST DELETE ONCE FIX PROVIDE - BEGIN
const parseSax = require('exceljs/lib/utils/parse-sax');
const utils = require('exceljs/lib/utils/utils');
const colCache = require('exceljs/lib/utils/col-cache');
const Row = require('exceljs/lib/doc/row');
const Column = require('exceljs/lib/doc/column');

const parseWorksheet = async function *parse() {
  const {iterator, options} = this;
  let emitSheet = false;
  let emitHyperlinks = false;
  let hyperlinks = null;
  switch (options.worksheets) {
    case 'emit':
      emitSheet = true;
      break;
    case 'prep':
      break;
    default:
      break;
  }
  switch (options.hyperlinks) {
    case 'emit':
      emitHyperlinks = true;
      break;
    case 'cache':
      this.hyperlinks = hyperlinks = {};
      break;
    default:
      break;
  }
  if (!emitSheet && !emitHyperlinks && !hyperlinks) {
    return;
  }

  // references
  const {sharedStrings, styles, properties} = this.workbook;

  // xml position
  let inCols = false;
  let inRows = false;
  let inHyperlinks = false;

  // parse state
  let cols = null;
  let row = null;
  let c = null;
  let current = null;
  for await (const events of parseSax(iterator)) {
    const worksheetEvents = [];
    for (const {eventType, value} of events) {
      if (eventType === 'opentag') {
        const node = value;
        if (emitSheet) {
          switch (node.name) {
            case 'cols':
              inCols = true;
              cols = [];
              break;
            case 'sheetData':
              inRows = true;
              break;

            case 'col':
              if (inCols) {
                cols.push({
                  min: parseInt(node.attributes.min, 10),
                  max: parseInt(node.attributes.max, 10),
                  width: parseFloat(node.attributes.width),
                  styleId: parseInt(node.attributes.style || '0', 10),
                });
              }
              break;

            case 'row':
              if (inRows) {
                const r = parseInt(node.attributes.r, 10);
                row = new Row(this, r);
                if (node.attributes.ht) {
                  row.height = parseFloat(node.attributes.ht);
                }
                if (node.attributes.s) {
                  const styleId = parseInt(node.attributes.s, 10);
                  const style = styles.getStyleModel(styleId);
                  if (style) {
                    row.style = style;
                  }
                }
              }
              break;
            case 'c':
              if (row) {
                c = {
                  ref: node.attributes.r,
                  s: parseInt(node.attributes.s, 10),
                  t: node.attributes.t,
                };
              }
              break;
            case 'f':
              if (c) {
                current = c.f = {text: ''};
              }
              break;
            case 'v':
              if (c) {
                current = c.v = {text: ''};
              }
              break;
            case 'is':
            case 't':
              if (c) {
                current = c.v = {text: ''};
              }
              break;
            case 'mergeCell':
              break;
            default:
              break;
          }
        }

        // =================================================================
        //
        if (emitHyperlinks || hyperlinks) {
          switch (node.name) {
            case 'hyperlinks':
              inHyperlinks = true;
              break;
            case 'hyperlink':
              if (inHyperlinks) {
                const hyperlink = {
                  ref: node.attributes.ref,
                  rId: node.attributes['r:id'],
                };
                if (emitHyperlinks) {
                  worksheetEvents.push({eventType: 'hyperlink', value: hyperlink});
                } else {
                  hyperlinks[hyperlink.ref] = hyperlink;
                }
              }
              break;
            default:
              break;
          }
        }
      } else if (eventType === 'text') {
        // only text data is for sheet values
        if (emitSheet) {
          if (current) {
            current.text += value;
          }
        }
      } else if (eventType === 'closetag') {
        const node = value;
        if (emitSheet) {
          switch (node.name) {
            case 'cols':
              inCols = false;
              this._columns = Column.fromModel(cols);
              break;
            case 'sheetData':
              inRows = false;
              break;

            case 'row':
              this._dimensions.expandRow(row);
              worksheetEvents.push({eventType: 'row', value: row});
              row = null;
              break;

            case 'c':
              if (row && c) {
                const address = colCache.decodeAddress(c.ref);
                const cell = row.getCell(address.col);
                if (c.s) {
                  const style = styles.getStyleModel(c.s);
                  if (style) {
                    cell.style = style;
                  }
                }

                if (c.f) {
                  const cellValue = {
                    formula: c.f.text,
                  };
                  if (c.v) {
                    if (c.t === 'str') {
                      cellValue.result = utils.xmlDecode(c.v.text);
                    } else {
                      cellValue.result = parseFloat(c.v.text);
                    }
                  }
                  cell.value = cellValue;
                } else if (c.v) {
                  switch (c.t) {
                    case 's': {
                      const index = parseInt(c.v.text, 10);
                      if (sharedStrings) {
                        cell.value = sharedStrings[index];
                      } else {
                        cell.value = {
                          sharedString: index,
                        };
                      }
                      break;
                    }

                    case 'inlineStr':
                    case 'str':
                      cell.value = utils.xmlDecode(c.v.text);
                      break;

                    case 'e':
                      cell.value = {error: c.v.text};
                      break;

                    case 'b':
                      cell.value = parseInt(c.v.text, 10) !== 0;
                      break;

                    default:
                      if (utils.isDateFmt(cell.numFmt)) {
                        cell.value = utils.excelToDate(
                          parseFloat(c.v.text),
                          properties.model && properties.model.date1904
                        );
                      } else {
                        cell.value = parseFloat(c.v.text);
                      }
                      break;
                  }
                }
                if (hyperlinks) {
                  const hyperlink = hyperlinks[c.ref];
                  if (hyperlink) {
                    cell.text = cell.value;
                    cell.value = undefined;
                    cell.hyperlink = hyperlink;
                  }
                }
                c = null;
              }
              break;
            default:
              break;
          }
        }
        if (emitHyperlinks || hyperlinks) {
          switch (node.name) {
            case 'hyperlinks':
              inHyperlinks = false;
              break;
            default:
              break;
          }
        }
      }
    }
    if (worksheetEvents.length > 0) {
      yield worksheetEvents;
    }
  }
};
// MUST DELETE ONCE FIX PROVIDE - END

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
 * @param inZip - flag specifying if the zip extensions are the ones to be checked
 * @return {boolean}
 */
const isExtensionSupported = function (extension, inZip = false) {
  const extensionsToBeChecked = inZip ? supportedFileExtensionsInZip : supportedFileExtensions;
  return extensionsToBeChecked.indexOf(extension) !== -1;
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
 * Get needed information from JSON content and store file
 * Reads JSON stream and writes a JSON file with the needed structure
 * Makes the following calculations in order to not need to traverse the entire JSON again
 * Calculates headers, values for each header, array properties max length, questionnaire max answers map
 * @param filePath
 * @param extension
 * @param options - Options used for calculations
 */
const getJsonHeaders = function (filePath, extension, options) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath);

    // store file in temporary folder
    const fileId = uuid.v4();
    const writeStream = fs.createWriteStream(path.join(os.tmpdir(), fileId));
    writeStream.on('error', (err) => {
      // destroy readStream which will cause the entire pipeline to error
      readStream.destroy();

      reject(err);
    });

    /**
     * Write to writeStream
     */
    const writeToStream = (data) => {
      return new Promise(resolve => {
        if (!writeStream.write(data)) {
          writeStream.once('drain', () => {
            resolve();
          });
        } else {
          process.nextTick(resolve);
        }
      });
    };

    // build a list of headers
    const headers = [];
    // store list of properties for each header
    const headersToPropsMap = {};

    // store array properties max length; will be filled in the traverseItemToGetArrayPropertiesMaxLength function
    const fileArrayHeaders = {};
    const traverseItemToGetArrayPropertiesMaxLength = function (obj, ref) {
      for (let prop in obj) {
        if (obj.hasOwnProperty(prop)) {
          const resultPropRef = `${ref ? ref + '.' : ''}${prop}`;
          if (Array.isArray(obj[prop])) {
            !fileArrayHeaders[resultPropRef] && (fileArrayHeaders[resultPropRef] = {
              maxItems: 0
            });
            const objPropLength = obj[prop].length;
            if (fileArrayHeaders[resultPropRef].maxItems < objPropLength) {
              fileArrayHeaders[resultPropRef].maxItems = objPropLength;
            }

            for (let arrProp of obj[prop]) {
              if (typeof arrProp === 'object' && arrProp !== null && !Array.isArray(obj[prop])) {
                traverseItemToGetArrayPropertiesMaxLength(arrProp, `${resultPropRef}[]`);
              }
            }
          }
          if (typeof obj[prop] === 'object' && obj[prop] !== null && !Array.isArray(obj[prop])) {
            traverseItemToGetArrayPropertiesMaxLength(obj[prop], resultPropRef);
          }
        }
      }
    };

    // calculate questionnaire max answers map
    // get a map of all the multi date answer questions and their nested questions
    const questionnaireMaxAnswersMap = {};
    if (options.modelOptions) {
      Object.keys(options.modelOptions).forEach(modelName => {
        const assocModelOptions = options.modelOptions[modelName];
        const modelQuestionnaire = (
          assocModelOptions.extendedForm && assocModelOptions.extendedForm.templateMultiDateQuestions ?
            assocModelOptions.extendedForm.templateMultiDateQuestions :
            []
        ).filter(q => q.multiAnswer);

        if (modelQuestionnaire.length) {
          questionnaireMaxAnswersMap[modelName] = {};
          (function parseQuestion(questions) {
            (questions || []).forEach(question => {
              questionnaireMaxAnswersMap[modelName][question.variable] = 0;
              (question.answers || []).forEach(answer => parseQuestion(answer.additionalQuestions));
            });
          })(modelQuestionnaire);
        }
      });
    }
    const addInQuestionnaireAnswersMap = function (record) {
      Object.keys(questionnaireMaxAnswersMap).forEach(modelName => {
        const assocModelOptions = options.modelOptions[modelName];
        const multiDateQuestionsMap = questionnaireMaxAnswersMap[modelName];

        let propToIterate = 'questionnaireAnswers';
        if (!record[propToIterate]) {
          if (record[assocModelOptions.extendedForm.templateContainerPropTranslation]) {
            propToIterate = assocModelOptions.extendedForm.templateContainerPropTranslation;
          } else {
            // it doesn't have any questions, skip it
            return;
          }
        }

        for (let q in record[propToIterate]) {
          if (record[propToIterate][q]) {
            let length;
            let variable;

            if (multiDateQuestionsMap[q]) {
              length = record[propToIterate][q].length;
              variable = q;
            } else if (assocModelOptions.extendedForm.questionTranslationToVariableMap[q]) {
              length = record[propToIterate][q].length;
              variable = assocModelOptions.extendedForm.questionTranslationToVariableMap[q];
            }

            if (
              length !== undefined &&
              (
                multiDateQuestionsMap[variable] === undefined ||
                multiDateQuestionsMap[variable] < length
              )
            ) {
              multiDateQuestionsMap[variable] = length;
            }
          }
        }
      });
    };

    let firstItem = true;
    let totalNoItems = 0;
    // write start of new file
    const batchSize = 100;
    let batchData = '';
    let batchCount = 0;
    const sanitizedPropertiesMap = {};
    return writeToStream('[')
      .then(() => {
        // run pipeline which will read contents, make required calculations on each data and write the needed entry to the new file
        return pipeline(
          readStream,
          jsonStream.parse('*'),
          es.through(function (item) {
            const that = this;

            // go through all properties of flatten item
            const flatItem = helpers.getFlatObject(item);
            Object.keys(flatItem).forEach(function (property) {
              !sanitizedPropertiesMap[property] && (sanitizedPropertiesMap[property] = property
                // don't replace basic types arrays ( string, number, dates etc )
                .replace(/\[\d+]$/g, '')
                // sanitize arrays containing objects object
                .replace(/\[\d+]/g, '[]')
                .replace(/^\[]\.*/, ''));
              // add the header if not already included
              if (!headersToPropsMap[sanitizedPropertiesMap[property]]) {
                headers.push(sanitizedPropertiesMap[property]);
                headersToPropsMap[sanitizedPropertiesMap[property]] = new Set();
              }

              // add prop to headers map if simple property; null values are skipped
              // children of object properties will be added separately
              if (typeof flatItem[property] !== 'object') {
                headersToPropsMap[sanitizedPropertiesMap[property]].add(property);
              }
            });

            traverseItemToGetArrayPropertiesMaxLength(item);

            addInQuestionnaireAnswersMap(item);

            let dataToWrite;
            try {
              dataToWrite = JSON.stringify(item);
            } catch (err) {
              // data couldn't be stringifed
              // error invalid content; destroy readstream as it will destroy entire pipeline
              !readStream.destroyed && readStream.destroy(apiError.getError('INVALID_CONTENT_OF_TYPE', {
                contentType: 'JSON',
                details: 'it should contain an array'
              }));
            }

            batchData += (firstItem ? '' : ',') + dataToWrite;
            batchCount++;
            totalNoItems++;

            // write batch if batchSize was reached
            if (batchCount >= batchSize) {
              that.pause();
              writeToStream(batchData)
                .then(() => {
                  batchCount = 0;
                  batchData = '';
                  that.resume();
                });
            }
            firstItem = false;
          })
        );
      })
      .then(() => {
        // all data was processed
        // write the remaining items in batchData and the rest of the file
        return writeToStream(`${batchData}]`);
      })
      .then(() => {
        writeStream.close();

        // write headers file
        const headersFormat = 'json';

        // add headers to prop map in file
        let cHeadersToPropMap;
        if (headersToPropsMap) {
          cHeadersToPropMap = {};
          headers.forEach(header => {
            cHeadersToPropMap[header] = [...headersToPropsMap[header]];
          });
        }

        return writeFile(path.join(os.tmpdir(), `${fileId}${metadataFileSuffix}`),
          `{"headersFormat":"${headersFormat}","headersToPropMap":${JSON.stringify(cHeadersToPropMap)},"totalNoItems":${totalNoItems}}`);
      })
      .then(() => {
        // new JSON file was successfully written; construct result to be used further
        resolve({
          id: fileId,
          extension,
          headers,
          fileArrayHeaders,
          questionnaireMaxAnswersMap
        });
      })
      .catch(err => {
        writeStream.destroy();
        reject(err);
      });
  });
};

/**
 * Get needed information from CSV content and store file
 * Reads CSV stream and writes a JSON file with the needed structure
 * @param filePath
 * @param extension
 */
const getCsvHeaders = function (filePath, extension) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath);

    // store file in temporary folder
    const fileId = uuid.v4();
    const writeStream = fs.createWriteStream(path.join(os.tmpdir(), fileId));
    writeStream.on('error', (err) => {
      // destroy readStream which will cause the entire pipeline to error
      readStream.destroy();

      reject(err);
    });

    /**
     * Write to writeStream
     */
    const writeToStream = (data) => {
      return new Promise(resolve => {
        if (!writeStream.write(data)) {
          writeStream.once('drain', () => {
            resolve();
          });
        } else {
          process.nextTick(resolve);
        }
      });
    };

    // build a list of headers
    let headers = [];

    let firstItem = true;
    let totalNoItems = 0;
    // write start of new file
    const batchSize = 100;
    let batchData = '';
    let batchCount = 0;
    return writeToStream('[')
      .then(() => {
        // run pipeline which will read contents, make required calculations on each data and write the needed entry to the new file
        return pipeline(
          readStream,
          csvParse({
            columns: true,
            columns_duplicates_to_array: true,
            trim: true
          }),
          es.through(function (item) {
            const that = this;

            !headers.length && (headers = Object.keys(item));

            // remove empty properties
            for (const prop in item) {
              if (item[prop] === '') {
                delete item[prop];
              }
            }

            let dataToWrite;
            try {
              dataToWrite = JSON.stringify(item);
            } catch (err) {
              // data couldn't be stringifed
              // error invalid content; destroy readstream as it will destroy entire pipeline
              !readStream.destroyed && readStream.destroy(apiError.getError('INVALID_CONTENT_OF_TYPE', {
                contentType: 'CSV',
                details: 'data couldn\'t be parsed'
              }));
            }

            batchData += (firstItem ? '' : ',') + dataToWrite;
            batchCount++;
            totalNoItems++;

            // write batch if batchSize was reached
            if (batchCount >= batchSize) {
              that.pause();
              writeToStream(batchData)
                .then(() => {
                  batchCount = 0;
                  batchData = '';
                  that.resume();
                });
            }
            firstItem = false;
          })
        );
      })
      .then(() => {
        // all data was processed
        // write the remaining items in batchData and the rest of the file
        return writeToStream(`${batchData}]`);
      })
      .then(() => {
        writeStream.close();

        // write headers file
        const headersFormat = 'xlsx';

        return writeFile(path.join(os.tmpdir(), `${fileId}${metadataFileSuffix}`),
          `{"headersFormat":"${headersFormat}","totalNoItems":${totalNoItems}}`);
      })
      .then(() => {
        // new JSON file was successfully written; construct result to be used further
        resolve({
          id: fileId,
          extension,
          headers
        });
      })
      .catch(err => {
        writeStream.destroy();
        reject(err);
      });
  });
};

/**
 * Get XLS/ODS fileContent as JSON and its headers
 * @param filesToParse - List of paths to parse
 * @param extension
 */
const getSpreadSheetHeaders = function (filesToParse, extension) {
  // parse XLS data
  const parseOptions = {
    cellText: false
  };
  parseOptions.cellDates = true;

  return new Promise((resolve, reject) => {
    // store file in temporary folder
    const fileId = uuid.v4();
    const writeStream = fs.createWriteStream(path.join(os.tmpdir(), fileId));
    writeStream.on('error', (err) => {
      reject(err);
    });

    /**
     * Write to writeStream
     */
    const writeToStream = (data) => {
      return new Promise(resolve => {
        if (!writeStream.write(data)) {
          writeStream.once('drain', () => {
            resolve();
          });
        } else {
          process.nextTick(resolve);
        }
      });
    };

    // build a list of headers
    const headers = [];

    let firstItem = true;
    let totalNoItems = 0;
    // write start of new file
    return writeToStream('[')
      .then(() => {
        return async.eachSeries(filesToParse, (filePath, callback) => {
          fs.readFile(filePath, function (error, data) {
            // handle error
            if (error) {
              return callback(apiError.getError('FILE_NOT_FOUND'));
            }

            const parsedData = xlsx.read(data, parseOptions);
            // extract first sheet name (we only care about first sheet)
            const sheetName = parsedData.SheetNames.shift();
            // convert data to JSON
            const jsonObj = xlsx.utils.sheet_to_json(parsedData.Sheets[sheetName], {
              dateNF: 'YYYY-MM-DD'
            });

            // if this is first file parse headers
            if (!headers.length) {
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

              // keep a list of how many times a header appears
              const sameHeaderCounter = {};
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

            totalNoItems += jsonObj.length;

            let dataToWrite;
            try {
              dataToWrite = JSON.stringify(jsonObj);
            } catch (err) {
              // data couldn't be stringifed
              // error invalid content
              callback(apiError.getError('INVALID_CONTENT_OF_TYPE', {
                contentType: extension.substring(1),
                details: 'parsed data should be valid XLSX'
              }));
            }

            // write file contents to JSON
            writeToStream((firstItem ? '' : ',') + dataToWrite.substring(1, dataToWrite.length - 1))
              .then(() => {
                callback();
              });

            firstItem = false;
          });
        });
      })
      .then(() => {
        // all data was processed
        // write the rest of the file
        return writeToStream(']');
      })
      .then(() => {
        writeStream.close();

        // write headers file
        const headersFormat = 'xlsx';

        return writeFile(path.join(os.tmpdir(), `${fileId}${metadataFileSuffix}`),
          `{"headersFormat":"${headersFormat}","totalNoItems":${totalNoItems}}`);
      })
      .then(() => {
        // new JSON file was successfully written; construct result to be used further
        resolve({
          id: fileId,
          extension,
          headers
        });
      })
      .catch(err => {
        writeStream.destroy();
        reject(err);
      });
  });
};

/**
 * Get XLSX fileContent as JSON and its headers
 * Add data from all xlsx files into single JSON
 * @param {Array} filesToParse - List of paths to parse
 * @param {string} extension - file extension
 */
const getXlsxHeaders = function (filesToParse, extension) {
  return new Promise((resolve, reject) => {
    // initialize read stream variable; will be used to read all files
    let readStream;

    // store file in temporary folder
    const fileId = uuid.v4();
    const writeStream = fs.createWriteStream(path.join(os.tmpdir(), fileId));
    writeStream.on('error', (err) => {
      // destroy readStream which will cause the entire pipeline to error
      readStream.destroy();

      reject(err);
    });

    /**
     * Write to writeStream
     */
    const writeToStream = (data) => {
      return new Promise(resolve => {
        if (!writeStream.write(data)) {
          writeStream.once('drain', () => {
            resolve();
          });
        } else {
          process.nextTick(resolve);
        }
      });
    };

    // build a list of headers
    const headers = [];
    const headersMap = {};

    let firstItem = true;
    let totalNoItems = 0;
    // write start of new file
    const batchSize = 100;
    let batchData = '';
    let batchCount = 0;
    return writeToStream('[')
      .then(() => {
        return async.eachSeries(filesToParse, (filePath, callback) => {
          let callbackCalled = false;

          readStream = fs.createReadStream(filePath);
          const workbookReader = new excel.stream.xlsx.WorkbookReader(readStream, {
            sharedStrings: 'cache'
          });
          workbookReader.read();
          workbookReader.on('worksheet', worksheet => {
            // #TODO - ugly hack until new version of excelljs is provided to include fix (4.3.0 didn't include this fix even if code is merged):
            // - https://github.com/exceljs/exceljs/pull/1576
            // MUST DELETE ONCE FIX PROVIDE - BEGIN
            worksheet.parse = parseWorksheet;
            // MUST DELETE ONCE FIX PROVIDE - END

            // parse rows
            worksheet.on('row', row => {
              // check for headers row
              if (row.number === 1) {
                // if this is first file parse headers
                if (!headers.length) {
                  // keep a list of how many times a header appears
                  const sameHeaderCounter = {};

                  // go through all columns
                  row._cells.forEach(cell => {
                    // check for formulae; we don't support them
                    if (typeof cell.value === 'object' && _.get(cell.value, 'formula')) {
                      workbookReader.emit('error', apiError.getError('INVALID_FILE_CONTENTS_SPREADSHEET_FORMULAE', {
                        cell: cell.address
                      }));
                    }

                    let header = cell.value;

                    // add extra information when column header is invalid so end user knows which column is invalid
                    if (
                      header === null ||
                      header === undefined ||
                      (header + '').toLowerCase().startsWith('null')
                    ) {
                      header = (header === undefined ? null : header) + ' - cell ' + (cell.model.address ? cell.model.address : '');
                    }

                    // if this is the first time the header appears
                    if (sameHeaderCounter[header] === undefined) {
                      // create an entry for it in the counter
                      sameHeaderCounter[header] = 0;
                    } else {
                      // increment counter
                      sameHeaderCounter[header]++;
                      // update header value to match those built by xlsx.utils.sheet_to_json (old functionality)
                      header = `${header}_${sameHeaderCounter[header]}`;
                    }

                    // fill maps
                    headers.push(header);
                    headersMap[cell._column.number] = header;
                  });
                }
                return;
              }

              // construct item directly as string to be ready to be written
              let firstKeyInItem = true;

              if (!row._cells.length) {
                // all cells are empty; don't add the row in JSON
                return;
              }
              let dataInRow = false;
              let item = row._cells.reduce((acc, cell) => {
                // check for formulae; we don't support them
                if (typeof cell.value === 'object' && _.get(cell.value, 'formula')) {
                  workbookReader.emit('error', apiError.getError('INVALID_FILE_CONTENTS_SPREADSHEET_FORMULAE', {
                    cell: cell.address
                  }));
                }

                if (!dataInRow && cell.value !== null) {
                  dataInRow = true;
                }

                const valueToWrite = typeof cell.value === 'string' ? `"${cell.value}"` : cell.value;

                acc += (firstKeyInItem ? '' : ',') + `"${headersMap[cell._column.number]}":${valueToWrite}`;
                firstKeyInItem = false;
                return acc;
              }, '{');
              item += '}';
              if (!dataInRow) {
                // all cells have null values; don't add the row in JSON
                return;
              }

              batchData += (firstItem ? '' : ',') + item;
              batchCount++;
              totalNoItems++;

              // write batch if batchSize was reached
              if (batchCount >= batchSize) {
                readStream.pause();
                writeToStream(batchData)
                  .then(() => {
                    readStream.resume();
                  });

                batchCount = 0;
                batchData = '';
              }
              firstItem = false;
            });
          });
          workbookReader.on('end', () => {
            callback();
          });
          workbookReader.on('error', (err) => {
            readStream.destroy();
            if (!callbackCalled) {
              callbackCalled = true;
              callback(err);
            }
          });
        });
      })
      .then(() => {
        // all data was processed
        // write the remaining items in batchData and the rest of the file
        return writeToStream(`${batchData}]`);
      })
      .then(() => {
        writeStream.close();

        // write headers file
        const headersFormat = 'xlsx';

        return writeFile(path.join(os.tmpdir(), `${fileId}${metadataFileSuffix}`),
          `{"headersFormat":"${headersFormat}","totalNoItems":${totalNoItems}}`);
      })
      .then(() => {
        // new JSON file was successfully written; construct result to be used further
        resolve({
          id: fileId,
          extension,
          headers
        });
      })
      .catch(err => {
        writeStream.destroy();
        reject(err);
      });
  });
};

/**
 * Store file and get its headers and file Id
 * @param file
 * @param decryptPassword
 * @param options - Options to be used in data parsing/calculations; Currently used only for JSON files
 * @returns {Promise<never>|Promise<unknown>}
 */
const storeFileAndGetHeaders = function (file, decryptPassword, options) {
  // get file extension
  let extension = path.extname(file.name).toLowerCase();
  // if extension is invalid
  if (extension !== zipExtension && !isExtensionSupported(extension)) {
    // send back the error
    return Promise.reject(apiError.getError('UNSUPPORTED_FILE_TYPE', {
      fileName: file.name,
      details: `unsupported extension ${extension}. Supported file extensions: ${supportedFileExtensions.join(', ')}`
    }));
  }

  // in case the file is a zip archive first unzip it
  const filesToParse = [];
  if (extension === zipExtension) {
    let tmpDirName;
    try {
      const tmpDir = tmp.dirSync({unsafeCleanup: true});
      tmpDirName = tmpDir.name;
    } catch (err) {
      return Promise.reject(err);
    }

    // extract zip
    try {
      let archive = new admZip(file.path);
      archive.extractAllTo(tmpDirName);
    } catch (zipError) {
      return Promise.reject(typeof zipError === 'string' ? {message: zipError} : zipError);
    }

    // cache all files extensions from zip
    const filesExtensions = new Set();
    // archive was unzipped; get new file extension
    for (const fileName of fs.readdirSync(tmpDirName)) {
      const fileExtension = path.extname(fileName).toLowerCase();
      filesExtensions.add(fileExtension);

      // on first file check its extension and use it further
      if (extension === zipExtension) {
        extension = path.extname(fileName).toLowerCase();
      }

      // if extension is invalid
      if (!isExtensionSupported(fileExtension, true)) {
        // send back the error
        return Promise.reject(apiError.getError('UNSUPPORTED_FILE_TYPE_IN_ZIP', {
          fileName: fileName,
          details: `unsupported extension ${extension}. Supported file extensions: ${supportedFileExtensionsInZip.join(', ')}`
        }));
      }

      filesToParse.push(path.join(tmpDirName, fileName));
    }

    // check if there are more than 1 file types
    if (filesExtensions.size > 1) {
      // send back the error
      return Promise.reject(apiError.getError('UNSUPPORTED_FILE_TYPE_IN_ZIP', {
        fileName: file.name,
        details: `ZIP archive contains more than 1 file types: ${[...filesExtensions].join(', ')}`
      }));
    }
  } else {
    filesToParse.push(file.path);
  }

  // decrypt file/files if needed
  let decryptPromise = Promise.resolve();
  if (decryptPassword) {
    let tmpDirName;
    try {
      const tmpDir = tmp.dirSync({unsafeCleanup: true});
      tmpDirName = tmpDir.name;
    } catch (err) {
      return Promise.reject(err);
    }

    decryptPromise = Promise.all(filesToParse.map((filePath, index) => {
      const decryptPath = path.join(tmpDirName, path.basename(filePath));
      const encryptedFileStream = fs.createReadStream(filePath);
      const decryptedFileStream = fs.createWriteStream(decryptPath);

      return aesCrypto.decryptStream(
        encryptedFileStream,
        decryptedFileStream,
        decryptPassword
      )
        .then(() => {
          // from now on use decrypted files
          filesToParse[index] = decryptPath;
        });
    }));
  }

  return decryptPromise
    .then(() => {
      // use appropriate content handler for file type
      switch (extension) {
        case '.json':
          // JSON import will always consist of one file
          return getJsonHeaders(filesToParse[0], extension, options);
        case '.csv':
          // CSV import will always consist of one file
          return getCsvHeaders(filesToParse[0], extension);
        case '.xls':
        case '.ods':
          return getSpreadSheetHeaders(filesToParse, extension);
        case '.xlsx':
          return getXlsxHeaders(filesToParse, extension);
      }
    })
    .catch(err => {
      return Promise.reject(err);
    });
};

/**
 * Get a list of distinct values for the given properties of the dataset
 * @param {string} fileId - File name to be read (contains the dataset)
 * @param {Object} fileMetadata - Imported file metadata as saved by the storeFileAndGetHeaders function
 * {
 * headersFormat: 'json/xlsx',
 * headersToPropMap: {
 *   'header': ['prop1', 'prop2']
 * }
 * }
 * @param {Array} properties - List of properties for which to return the distinct values
 * @returns {{}}
 */
const getDistinctPropertyValues = function (fileId, fileMetadata, properties) {
  // initialize result
  const result = {};

  if (!properties || !properties.length) {
    return result;
  }

  // initialize a set for each needed property
  properties.forEach(prop => {
    result[prop] = new Set();
  });

  // for JSON the properties for each header were stored when the file was imported
  const headersToPropMap = fileMetadata.headersToPropMap;

  // for xlsx create a sanitized properties map
  const sanitizedPropertiesMap = {};

  // read the dataset file
  const readStream = fs.createReadStream(path.join(os.tmpdir(), fileId));
  // run pipeline which will read contents and make required calculations on each data
  return pipeline(
    readStream,
    jsonStream.parse('*'),
    es.through(function (entry) {
      // check for the format of the headers in file
      switch (fileMetadata.headersFormat) {
        case 'json': {
          // get each requested property values from the dataset
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

          break;
        }
        case 'xlsx': {
          // get each requested property values from the dataset
          Object.keys(entry).forEach(prop => {
            // check if the requested prop is an actual entry prop
            if (result[prop]) {
              result[prop].add(entry[prop]);
              return;
            }

            // sanitize key (remove array markers)
            !sanitizedPropertiesMap[prop] && (sanitizedPropertiesMap[prop] = prop
              // don't replace basic types arrays ( string, number, dates etc )
              .replace(/\[\d+]$/g, '')
              // sanitize arrays containing objects
              .replace(/\[\d+]/g, '[]'));

            if (result[sanitizedPropertiesMap[prop]]) {
              result[sanitizedPropertiesMap[prop]].add(entry[prop]);
              return;
            }

            // at this point we have handled flat files
            // requested prop is not valid
          });
          break;
        }
        default:
          break;
      }
    })
  )
    .then(() => {
      // all data was processed
      // transform results to arrays
      Object.keys(result).forEach(prop => {
        if (!result[prop].size) {
          // add single "null" value to be consistent with old functionality
          result[prop] = [null + ''];
        } else {
          result[prop] = [...result[prop]];
        }
      });
      return result;
    });
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

      // construct projection
      const lProjection = {};
      if (typeof foreignKeyInfo.labelProperty === 'string') {
        lProjection[foreignKeyInfo.labelProperty] = 1;
      } else if (
        Array.isArray(foreignKeyInfo.labelProperty)
      ) {
        foreignKeyInfo.labelProperty.forEach((lProperty) => {
          lProjection[lProperty] = 1;
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
            projection: lProjection
          }
        ])
        .then(items => {
          return callback(null, items.map(item => {
            return {
              id: item.id,
              label: Array.isArray(foreignKeyInfo.labelProperty) ?
                foreignKeyInfo.labelProperty.map((lProperty) => item[lProperty]).join(' ') :
                item[foreignKeyInfo.labelProperty],
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
 */
const getReferenceDataAvailableValuesForModel = function (outbreakId, modelReferenceDataFieldsToCategoryMap) {
  // find (active) reference data for the referenced categories
  return baseReferenceDataModel.helpers
    .getSystemAndOutbreakReferenceData(outbreakId, {
      where: {
        categoryId: {
          inq: Object.values(modelReferenceDataFieldsToCategoryMap)
        },
        active: true
      },
      fields: ['id', 'categoryId', 'value', 'active', 'isSystemWide']
    })
    .then(function (referenceDataItems) {
      // init
      const data = {
        referenceDataValues: {},
        propToCategory: {}
      };

      // create a map of categories to items
      const referenceDataItemsByCategory = {};
      referenceDataItems.forEach(function (referenceDataItem) {
        if (!referenceDataItemsByCategory[referenceDataItem.categoryId]) {
          referenceDataItemsByCategory[referenceDataItem.categoryId] = [];
        }
        referenceDataItemsByCategory[referenceDataItem.categoryId].push({
          id: referenceDataItem.id,
          label: referenceDataItem.value,
          value: referenceDataItem.value,
          active: referenceDataItem.active,
          isSystemWide: referenceDataItem.isSystemWide
        });
      });

      // keep a list of available values for each reference data related property
      Object.keys(modelReferenceDataFieldsToCategoryMap).forEach(function (modelProperty) {
        // split the property in subcomponents
        data.propToCategory[modelProperty] = modelReferenceDataFieldsToCategoryMap[modelProperty];
        const propertyComponents = modelProperty.split('.');
        // if there are subcomponents
        if (propertyComponents.length > 1) {
          // define parent component
          if (!data.referenceDataValues[propertyComponents[0]]) {
            data.referenceDataValues[propertyComponents[0]] = {};
          }
          // store the sub component under parent component
          if (!data.referenceDataValues[propertyComponents[0]][propertyComponents[1]]) {
            data.referenceDataValues[propertyComponents[0]][propertyComponents[1]] = referenceDataItemsByCategory[modelReferenceDataFieldsToCategoryMap[modelProperty]] || [];
          }
        } else {
          // no subcomponents, store property directly
          data.referenceDataValues[modelProperty] = referenceDataItemsByCategory[modelReferenceDataFieldsToCategoryMap[modelProperty]] || [];
        }
      });

      return data;
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
 * @param questionnaireMaxAnswersMap
 * @return {Object}
 */
const getMappingSuggestionsForModelExtendedForm = function (outbreak, importType, modelExtendedForm, headers, normalizedHeaders, languageDictionary, questionnaireMaxAnswersMap) {
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
  const variables = modelExtendedForm.templateVariables;

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
    const containerProp = modelExtendedForm.containerProperty;

    for (let variable in questionnaireMaxAnswersMap) {
      result.modelArrayProperties[`${containerProp}.${variable}`] = {
        maxItems: questionnaireMaxAnswersMap[variable]
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

  // get file extension
  let extension = path.extname(file.name);

  // go through the list of models associated with the passed model name
  const associatedModelsOptions = options.associatedModels;

  // initialize options to be sent to file parser
  const optionsForParsingFile = {};
  const neededLanguageTokens = new Set();

  // calculate which tokens are needed in the language dictionary
  // also gather options for file parser
  Object.keys(associatedModelsOptions).forEach(modelName => {
    const assocModelOptions = associatedModelsOptions[modelName];
    // get model's field labels map
    const fieldLabelsMap = assocModelOptions.fieldLabelsMap || {};

    // if the model has importable properties, get their headers and try to suggest some mappings
    if (assocModelOptions.importableProperties && assocModelOptions.importableProperties.length) {
      // we need language tokens for normalized importable properties; also cache the normalized values
      assocModelOptions.importablePropertiesNormalized = {};
      assocModelOptions.importableProperties.forEach(function (property) {
        // get normalized token
        const normalizedToken = fieldLabelsMap[property] ?
          fieldLabelsMap[property] : (
            property && property.indexOf('[]') && fieldLabelsMap[property.replace(/\[]/g, '')] ?
              fieldLabelsMap[property.replace(/\[]/g, '')] :
              fieldLabelsMap[property]
          );

        // cache normalized value; will be used further in the steps
        assocModelOptions.importablePropertiesNormalized[property] = normalizedToken;

        // get the normalized token in the dictionary
        neededLanguageTokens.add(normalizedToken);
      });
    }

    // if outbreakId was sent (templates are stored at outbreak level) and the model uses extended form template
    // get options for getting mapping suggestions from records
    if (outbreakId !== undefined && assocModelOptions.extendedForm && assocModelOptions.extendedForm.template) {
      // extract and cache variables from template
      assocModelOptions.extendedForm.templateVariables = helpers.extractVariablesAndAnswerOptions(outbreak[assocModelOptions.extendedForm.template]);

      // if variables are present get tokens for translation
      if (assocModelOptions.extendedForm.templateVariables.length) {
        assocModelOptions.extendedForm.templateVariables.forEach(function (variable) {
          // get the normalized variables in the dictionary
          neededLanguageTokens.add(variable.text);
        });
      }

      // for JSON file we need to make some calculations when the file is parsed and also get other language tokens
      if (extension === '.json') {
        // need to also get translations for multidate questions
        assocModelOptions.extendedForm.templateMultiDateQuestions = outbreak[assocModelOptions.extendedForm.template].filter(q => q.multiAnswer);
        // create a question variable to translation map; translation will be added after the dictionary is loaded
        // in order to be able to calculate maximum number of answers for datasets that use translations as field names
        assocModelOptions.extendedForm.questionToTranslationMap = [];
        (function getLanguageToken(questions) {
          return questions
            .forEach(question => {
              question = question.toJSON ? question.toJSON() : question;

              assocModelOptions.extendedForm.questionToTranslationMap.push({
                variable: question.variable,
                text: question.text
              });

              // get the normalized questions in the dictionary
              neededLanguageTokens.add(question.text);

              (question.answers || []).forEach(answer => {
                getLanguageToken(answer.additionalQuestions || []);
              });
            });
        })(assocModelOptions.extendedForm.templateMultiDateQuestions);

        // also get extended form container property translation
        // as the JSON file might contain actual translation of the fields and we need to match it against the variable
        const containerProp = assocModelOptions.extendedForm.containerProperty;
        assocModelOptions.extendedForm.templateContainerProp = fieldLabelsMap[containerProp];
        neededLanguageTokens.add(fieldLabelsMap[containerProp]);

        // set model options to be sent to file parser
        !optionsForParsingFile.modelOptions && (optionsForParsingFile.modelOptions = {});
        optionsForParsingFile.modelOptions[modelName] = assocModelOptions;
      }
    }
  });

  // cache language dictionary for the user
  let languageDictionary;

  return baseLanguageModel.helpers.getLanguageDictionary(languageId, {
    token: {
      $in: [...neededLanguageTokens]
    }
  })
    .then(dictionary => {
      languageDictionary = dictionary;

      // for JSON file add the translation to questionToTranslationMap to be used in the file parser
      if (extension === '.json' && optionsForParsingFile.modelOptions) {
        Object.keys(optionsForParsingFile.modelOptions).forEach(modelName => {
          const assocModelOptions = optionsForParsingFile.modelOptions[modelName];
          if (assocModelOptions.extendedForm && assocModelOptions.extendedForm.questionToTranslationMap) {
            // translation for container prop
            assocModelOptions.extendedForm.templateContainerPropTranslation = languageDictionary.getTranslation(assocModelOptions.extendedForm.templateContainerProp);

            // translations for all questions
            assocModelOptions.extendedForm.questionTranslationToVariableMap = {};
            assocModelOptions.extendedForm.questionToTranslationMap.forEach(entry => {
              entry.translation = languageDictionary.getTranslation(entry.text);
              assocModelOptions.extendedForm.questionTranslationToVariableMap[entry.translation] = entry.variable;
            });
          }
        });
      }

      // store the file and get its headers
      return storeFileAndGetHeaders(file, decryptPassword, optionsForParsingFile);
    })
    .then(parseFileResult => {
      // get file extension
      extension = parseFileResult.extension;

      // define main result
      let result = {
        id: parseFileResult.id,
        fileHeaders: parseFileResult.headers
      };

      // store results for multiple models
      const results = {};
      // define normalized headers, they will be updated (conditionally) later
      let normalizedHeaders = {};
      // store a list of steps that will be executed
      const steps = [];
      // store main model name
      const mainModelName = options.modelName;

      Object.keys(associatedModelsOptions).forEach(modelName => {
        const assocModelOptions = associatedModelsOptions[modelName];

        // each model has its own results
        results[modelName] = {
          modelProperties: {},
          suggestedFieldMapping: {},
          modelPropertyValues: {},
          modelPropertyToRefCategory: {},
          modelArrayProperties: {}
        };

        // get array properties maximum length for non-flat files; already calculated when JSON was parsed
        if (['.json'].includes(extension)) {
          results[modelName].fileArrayHeaders = parseFileResult.fileArrayHeaders;
        }

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

                // retrieve normalized token already calculated above
                const normalizedToken = assocModelOptions.importablePropertiesNormalized[property];

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
                  results[modelName].modelProperties[property] = normalizedToken;
                }
                return stripSpecialCharsToLowerCase(languageDictionary.getTranslation(normalizedToken));
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
                .then(function (refData) {
                  // update result
                  results[modelName] = Object.assign(
                    {},
                    results[modelName], {
                      modelPropertyValues: _.merge(results[modelName].modelPropertyValues, refData.referenceDataValues),
                      modelPropertyToRefCategory: _.merge(results[modelName].modelPropertyToRefCategory, refData.propToCategory)
                    }
                  );
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
              const extendedFormSuggestions = getMappingSuggestionsForModelExtendedForm(
                outbreak,
                extension,
                assocModelOptions.extendedForm,
                result.fileHeaders,
                normalizedHeaders,
                languageDictionary,
                parseFileResult.questionnaireMaxAnswersMap ? parseFileResult.questionnaireMaxAnswersMap[modelName] : null);
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
  // get headers file
  return getTemporaryFileById(`${fileId}${metadataFileSuffix}`)
    .then(fileMetadata => {
      return getDistinctPropertyValues(fileId, fileMetadata, headers);
    })
    .then(result => {
      return {
        distinctFileColumnValues: result
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
      actionCompletionDate: localizationHelper.now().toDate(),
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
          // might be null
          if (!value) {
            return;
          }

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
            actionStartDate: localizationHelper.now().toDate(),
            status: 'LNG_SYNC_STATUS_IN_PROGRESS',
            resourceType: options.modelName,
            totalNo: total,
            processedNo: 0,
            outbreakIDs: options.outbreakId ? [options.outbreakId] : undefined
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
        Promise.resolve()
          .then(() => {
            return batchHandler(batchData);
          })
          .then(operations => {
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
  processImportableFileData,
  metadataFileSuffix
};
