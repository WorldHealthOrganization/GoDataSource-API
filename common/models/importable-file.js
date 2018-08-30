'use strict';

const app = require('../../server/server');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const xlsx = require('xlsx');
const os = require('os');
const uuid = require('uuid');

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
   * @param stringifiedJson
   * @param callback
   */
  function getJsonHeaders(stringifiedJson, callback) {
    // try and parse as a JSON
    try {
      const jsonObj = JSON.parse(stringifiedJson);
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
          const sanitizedProperty = property.replace(/\[\d+]/g, '').replace(/^\./, '');
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
   * @param callback
   */
  function getXmlHeaders(xmlString, callback) {
    // parse XML string
    xml2js.parseString(xmlString, {explicitRoot: false}, function (error, jsonObj) {
      // handle parse errors
      if (error) {
        return callback(error);
      }
      // XML arrays are stored within a prop, get the first property of the object
      const firstProp = Object.keys(jsonObj).shift();
      // this needs to be a list (in order to get its headers)
      if (!Array.isArray(jsonObj[firstProp])) {
        // error invalid content
        return callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
          contentType: 'XML',
          details: 'it should contain an array'
        }));
      }
      // build a list of headers
      const headers = [];
      // build the list by looking at the properties of all elements (not all items have all properties)
      jsonObj[firstProp].forEach(function (item) {
        // go through all properties of flatten item
        Object.keys(app.utils.helpers.getFlatObject(item)).forEach(function (property) {
          const sanitizedProperty = property.replace(/\[\d+]/g, '').replace(/^\./, '');
          // add the header if not already included
          if (!headers.includes(sanitizedProperty)) {
            headers.push(sanitizedProperty);
          }
        });
      });
      // send back the parsed object and its headers
      callback(null, {obj: jsonObj[firstProp], headers: headers});
    });
  }

  /**
   * Get XLS/XLSX/CSV/ODS fileContent as JSON and its headers
   * @param fileContent
   * @param callback
   */
  function getSpreadSheetHeaders(fileContent, callback) {
    // parse XLS data
    const parsedData = xlsx.read(fileContent, {cellDates: true, cellNF: false, cellText: false});
    // extract first sheet name (we only care about first sheet)
    let sheetName = parsedData.SheetNames.shift();
    // convert data to JSON
    let jsonObj = xlsx.utils.sheet_to_json(parsedData.Sheets[sheetName], {dateNF: 'YYYY-MM-DD\'T\'hh:mm:ss.000\'Z\''});
    // get sheer range
    let range = /^[A-Za-z]+\d+:([A-Za-z])+\d+$/.exec(parsedData.Sheets[sheetName]['!ref']);
    // keep a list of headers
    let headers = [];
    // keep a list of how many times a header appears
    let sameHeaderCounter = {};
    if (range) {
      // look for headers in the range
      for (let i = 'A'.charCodeAt(0); i <= range[1].charCodeAt(0); i++) {
        if (parsedData.Sheets[sheetName][`${String.fromCharCode(i)}1`]) {
          let headerValue = parsedData.Sheets[sheetName][`${String.fromCharCode(i)}1`].v;
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
        }
      }
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
   * @return {*}
   */
  ImportableFile.storeFileAndGetHeaders = function (file, decryptPassword, callback) {
    // get file extension
    const extension = path.extname(file.name);
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
          getHeaders(buffer, function (error, result) {
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
