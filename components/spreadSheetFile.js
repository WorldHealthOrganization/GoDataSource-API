'use strict';

const xlsx = require('xlsx');

/**
 * Build a spread sheet using headers and data
 * @param headers
 * @param data
 * @return {WorkSheet}
 */
function buildSpreadSheet(headers, data) {
  // reformat data to use correct headers
  let formattedData = [];

  // if headers were passed, reformat data
  if (headers) {
    // if there's data passed
    if (data.length) {
      // go through all entries
      data.forEach(function (entry) {
        // build formatted entry
        const formattedEntry = {};
        // use headers as properties
        headers.forEach(function (header) {
          formattedEntry[header.header] = entry[header.id];
        });
        // add formatted entry to the list
        formattedData.push(formattedEntry);
      });
    } else {
      // no data passed
      const formattedEntry = {};
      //add one empty data row (to include headers)
      headers.forEach(function (header) {
        formattedEntry[header.header] = '';
      });
      // add formatted entry to the list
      formattedData.push(formattedEntry);
    }
    // otherwise use it as is
  } else {
    formattedData = data;
  }

  // build the worksheet based on the built JSON
  return xlsx.utils.json_to_sheet(formattedData);
}

/**
 * Build CSV file using headers and data. This operation is sync but, in order to be consistent with other builders
 * (e.g. PDF) return data via callback function
 * @param headers
 * @param data
 * @param callback
 */
function createCsvFile(headers, data, callback) {
  const sheet = buildSpreadSheet(headers, data);
  // send back the sheet as CSV file
  callback(null, xlsx.utils.sheet_to_csv(sheet));
}

/**
 * Create an excel file or defined type
 * @param headers
 * @param data
 * @param type
 * @param callback
 */
function createExcelFile(headers, data, type, callback) {
  const sheet = buildSpreadSheet(headers, data);
  const workBook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workBook, sheet);
  callback(null, xlsx.write(workBook, {type: 'buffer', bookType: type}));
}

/**
 * Create XLS file
 * @param headers
 * @param data
 * @param callback
 */
function createXlsFile(headers, data, callback) {
  createExcelFile(headers, data, 'biff8', callback);
}

/**
 * Create XLSX file
 * @param headers
 * @param data
 * @param callback
 */
function createXlsxFile(headers, data, callback) {
  createExcelFile(headers, data, 'xlsx', callback);
}

/**
 * Create ODS file
 * @param headers
 * @param data
 * @param callback
 */
function createOdsFile(headers, data, callback) {
  createExcelFile(headers, data, 'ods', callback);
}

module.exports = {
  createCsvFile: createCsvFile,
  createXlsFile: createXlsFile,
  createXlsxFile: createXlsxFile,
  createOdsFile: createOdsFile
};
