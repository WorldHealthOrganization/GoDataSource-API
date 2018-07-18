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
  const formattedData = [];

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

module.exports = {
  createCsvFile: createCsvFile
};
