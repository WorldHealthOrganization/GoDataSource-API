'use strict';

const app = require('../../server/server');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const xlsx = require('xlsx');
const os = require('os');
const uuid = require('uuid');
const sort = require('alphanum-sort');

module.exports = function (ImportableFile) {

  // set flag to force using the controller
  ImportableFile.hasController = true;

  // define a list of supported file extensions
  ImportableFile.supportedFileExtensions = [
    '.json',
    '.xml',
    '.csv',
    '.xls',
    '.xlsx',
    '.ods'
  ];

  /**
   * Validate file extension
   * @param extension
   * @return {boolean}
   */
  function isExtensionSupported(extension) {
    return ImportableFile.supportedFileExtensions.indexOf(extension) !== -1;
  }

  /**
   * Get JSON content and headers
   * @param data
   * @param callback
   */
  function getJsonHeaders({ data }, callback) {
    // try and parse as a JSON
    try {
      const jsonObj = JSON.parse(data);
      // this needs to be a list (in order to get its headers)
      if (!Array.isArray(jsonObj)) {
        // error invalid content
        return callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
          contentType: 'JSON',
          details: 'it should contain an array'
        }));
      }
      // build a list of headers
      const headers = [];
      // build the list by looking at the properties of all elements (not all items have all properties)
      jsonObj.forEach(function (item) {
        // go through all properties of flatten item
        Object.keys(app.utils.helpers.getFlatObject(item)).forEach(function (property) {
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
    }
    catch (error) {
      // handle JSON.parse errors
      callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
        contentType: 'JSON',
        details: error.message
      }));
    }
  }

  /**
   * Get XML string as JSON and its headers
   * @param xmlString
   * @param modelName
   * @param dictionary
   * @param questionnaire
   * @param callback
   */
  function getXmlHeaders({ data, modelName, dictionary, questionnaire }, callback) {
    const parserOpts = {
      explicitArray: true,
      explicitRoot: false
    };

    const questionsTypeMap = {};
    const arrayProps = app.models[modelName].arrayProps || [];
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
        Object.keys(app.utils.helpers.getFlatObject(record))
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
  }

  /**
   * Get XLS/XLSX/CSV/ODS fileContent as JSON and its headers
   * @param data
   * @param callback
   */
  function getSpreadSheetHeaders({ data, extension }, callback) {
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
    let jsonObj = xlsx.utils.sheet_to_json(parsedData.Sheets[sheetName]);
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
  }

  /**
   * Store file on disk
   * @param content
   * @param callback
   */
  ImportableFile.temporaryStoreFileOnDisk = function (content, callback) {
    // create a unique file name
    const fileId = uuid.v4();
    // store file in temporary folder
    fs.writeFile(path.join(os.tmpdir(), fileId), content, function (error) {
      callback(error, fileId);
    });
  };

  /**
   * Get file using file id
   * @param fileId
   * @param callback
   */
  ImportableFile.getTemporaryFileById = function (fileId, callback) {
    fs.readFile(path.join(os.tmpdir(), fileId), callback);
  };

  /**
   * Store file and get its headers and file Id
   * @param file
   * @param callback
   * @param decryptPassword
   * @param modelName
   * @param dictionary
   * @return {*}
   */
  ImportableFile.storeFileAndGetHeaders = function (file, decryptPassword, modelName, dictionary, questionnaire, callback) {
    // get file extension
    const extension = path.extname(file.name).toLowerCase();
    // if extension is invalid
    if (!isExtensionSupported(extension)) {
      // send back the error
      return callback(app.utils.apiError.getError('UNSUPPORTED_FILE_TYPE', {
        fileName: file.name,
        details: `unsupported extension ${extension}. Supported file extensions: ${ImportableFile.supportedFileExtensions.join(', ')}`
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

    fs.readFile(file.path, function (error, buffer) {
      // handle error
      if (error) {
        return callback(error);
      }

      // decrypt file if needed
      let decryptFile;
      if (decryptPassword) {
        decryptFile = app.utils.aesCrypto.decrypt(decryptPassword, buffer);
      } else {
        decryptFile = Promise.resolve(buffer);
      }

      decryptFile
        .then(function (buffer) {
          // get file headers
          getHeaders({ data: buffer, modelName, dictionary, questionnaire, extension }, function (error, result) {
            // handle error
            if (error) {
              return callback(error);
            }
            // store file on dist
            ImportableFile.temporaryStoreFileOnDisk(JSON.stringify(result.obj), function (error, fileId) {
              // send back file id and headers
              callback(error, {
                id: fileId,
                headers: result.headers,
                jsonObj: result.obj
              });
            });
          });
        })
        .catch(callback);
    });
  };
};
