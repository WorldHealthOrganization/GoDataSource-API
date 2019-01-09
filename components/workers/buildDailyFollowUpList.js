'use strict';

const pdfUtils = require('../pdfDoc');

// Create the document
const doc = pdfUtils.createPdfDoc({
  fontSize: 6,
  layout: 'landscape',
  margin: 20,
  lineGap: 0,
  wordSpacing: 0,
  characterSpacing: 0,
  paragraphGap: 0
});

// add a top margin of 2 lines for each page
doc.on('pageAdded', () => {
  doc.moveDown(2);
});

const worker = {
  /**
   * Send data to worker
   * @param commonLabels
   * @param headers
   * @param dataSet
   */
  sendData: function (commonLabels, headers, dataSet) {
    pdfUtils.addTitle(doc, commonLabels.title, 14);
    doc.moveDown(2);

    // add dataSets to doc
    Object.keys(dataSet).forEach(function (recordSetId, index) {

      const recordSet = dataSet[recordSetId];
      // Add contact information at the start of each page
      pdfUtils.addTitle(doc, `${commonLabels.groupTitle}: ${recordSet.name}`, 14);
      doc.moveDown(3);

      // Add the follow-up table
      pdfUtils.createTableInPDFDocument(headers, recordSet.records, doc);

      // if this is not the last record on in the last dataSet, add a new page for the next record
      if (index < Object.keys(dataSet).length - 1) {
        // Add a new page for every contact
        doc.addPage();
      }
    });
    doc.end();
  }
};

// store buffers
let buffers = [];
// store end flag
let end = false;

/**
 * Flush buffers every second
 */
(function flushBuffers() {
  // if there are buffers to be flushed
  if (buffers.length) {
    // flush them
    process.send([null, {chunk: Buffer.concat(buffers)}]);
    buffers = [];
  }
  // if doc finished
  if (end) {
    // inform the client
    process.send([null, {end: true}]);
  } else {
    // register next flush
    setTimeout(flushBuffers, 1000);
  }
})();

// buffer the data, don't flush it immediately (don't block the event loop)
doc.on('data', function (chunk) {
  buffers.push(chunk);
});
// document finished
doc.on('end', function () {
  end = true;
});

// handle client messages
process.on('message', function (message) {
  worker[message.fn](...message.args);
});
