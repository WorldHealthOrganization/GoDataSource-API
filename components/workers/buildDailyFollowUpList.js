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
   * @param lastSet
   */
  sendData: function (commonLabels, headers, dataSet, lastSet = false) {
    // add doc title
    pdfUtils.addTitle(doc, commonLabels.title, 14);

    doc.moveDown(2);

    // remember initial dataSet size and keep an index in order to know when to stop
    const initialDataSetLength = Object.keys(dataSet).length;
    let index = 0;

    // write rows to table in an async manner (in batches) to allow streaming to happen
    (function writeInBatches(dataSet) {
      // get dataset keys
      const dataSetKeys = Object.keys(dataSet);
      // if there is nothing left to process
      if (!dataSetKeys.length) {
        // inform the client that the worker is ready for the next batch
        return process.send([null, {readyForNextBatch: true}]);
      }
      // get recordSet id
      const recordSetId = dataSetKeys.pop();
      // get record set
      const recordSet = dataSet[recordSetId];
      // remove record that is to be processed from the recordSet
      delete dataSet[recordSetId];

      // store reset x
      const resetX = doc.x;

      // Add group title
      pdfUtils.addTitle(doc, `${commonLabels.groupTitle}: ${recordSet.name}`, 12);

      doc.moveDown(3);

      // Add the follow-up table (add data in batches)
      pdfUtils.createTableInPDFDocument(headers, recordSet.records, doc, null, null, function () {
        // reset doc.x to initial x (when adding tables the x changes)
        doc.x = resetX;

        // Add group total
        pdfUtils.addTitle(doc, `${commonLabels.total}: ${recordSet.records.length}`, 12);

        // if this is not the last record on in the last dataSet, add a new page for the next record
        if (!lastSet || index < Object.keys(initialDataSetLength).length - 1) {
          // Add a new page for every contact
          doc.addPage();
        }
        index++;
        // keep adding in batches until nothing left
        writeInBatches(dataSet);
      });
    })(dataSet);
  },
  /**
   * Inform the worker that there is no more data to be added
   */
  finish: function () {
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
