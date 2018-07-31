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
   * Get JSON file and headers
   * @param file
   * @param callback
   */
  function getJsonFileHeaders(file, callback) {
    // read the file
    fs.readFile(file, function (error, data) {
      // handle read errors
      if (error) {
        return callback(error);
      }
      // try and parse as a JSON
      try {
        const jsonObj = JSON.parse(data);
        // this needs to be a list (in order to get its headers)
        if (!Array.isArray(jsonObj)) {
          // error invalid content
          return callback(app.utils.apiError.getError("INVALID_CONTENT_OF_TYPE", {
            contentType: 'JSON',
            details: 'it should contain an array'
          }));
        }
        // send back the parsed object and its headers (prop names of the first item)
        callback(null, {obj: jsonObj, headers: Object.keys(jsonObj.shift())});
      }
      catch (error) {
        // handle JSON.parse errors
        callback(app.utils.apiError.getError("INVALID_CONTENT_OF_TYPE", {
          contentType: 'JSON',
          details: error.message
        }));
      }
    });
  }

  /**
   * Get XML file as JSON and its headers
   * @param file
   * @param callback
   */
  function getXmlFileHeaders(file, callback) {
    // read the file
    fs.readFile(file, function (error, data) {
      // handle read errors
      if (error) {
        return callback(error);
      }
      // parse XML string
      xml2js.parseString(data, {explicitRoot: false}, function (error, jsonObj) {
        // handle parse errors
        if (error) {
          return callback(error);
        }
        // XML arrays are stored within a prop, get the first property of the object
        const firstProp = Object.keys(jsonObj).shift();
        // this needs to be a list (in order to get its headers)
        if (!Array.isArray(jsonObj[firstProp])) {
          // error invalid content
          return callback(app.utils.apiError.getError("INVALID_CONTENT_OF_TYPE", {
            contentType: 'XML',
            details: 'it should contain an array'
          }));
        }
        // send back the parsed object and its headers (prop names of the first item)
        callback(null, {obj: jsonObj[firstProp], headers: Object.keys(jsonObj[firstProp].shift())});
      });
    });
  }

  /**
   * Get XLS/XLSX/CSV/ODS file as JSON and its headers
   * @param file
   * @param callback
   */
  function getSpreadSheetFileHeaders(file, callback) {
    // read the file
    fs.readFile(file, function (error, data) {
      // handle read errors
      if (error) {
        return callback(error);
      }
      // parse XLS data
      const parsedData = xlsx.read(data);
      // extract first sheet name (we only care about first sheet)
      let sheetName = parsedData.SheetNames.shift();
      // convert data to JSON
      let jsonObj = xlsx.utils.sheet_to_json(parsedData.Sheets[sheetName]);
      // get sheer range
      let range = /^[A-Za-z]+\d+:([A-Za-z])+\d+$/.exec(parsedData.Sheets[sheetName]['!ref']);
      // keep a list of headers
      let headers = [];
      if (range) {
        // look for headers in the range
        for (let i = 'A'.charCodeAt(0); i <= range[1].charCodeAt(0); i++) {
          if (parsedData.Sheets[sheetName][`${String.fromCharCode(i)}1`]) {
            headers.push(parsedData.Sheets[sheetName][`${String.fromCharCode(i)}1`].v);
          }
        }
      }
      // should always be an array (sheets are lists)
      // send back the parsed object and its headers
      callback(null, {obj: jsonObj, headers: headers});
    });
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
   * @return {*}
   */
  ImportableFile.storeFileAndGetHeaders = function (file, callback) {
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
        getHeaders = getJsonFileHeaders;
        break;
      case '.xml':
        getHeaders = getXmlFileHeaders;
        break;
      case '.csv':
      case '.xls':
      case '.xlsx':
      case '.ods':
        getHeaders = getSpreadSheetFileHeaders;
        break;
    }
    // get file headers
    getHeaders(file.path, function (error, result) {
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
  };
};
