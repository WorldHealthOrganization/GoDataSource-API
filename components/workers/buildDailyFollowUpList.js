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
   * @param dataSet
   * @param lastSet
   */
  sendData: function (dataSet, lastSet = false) {
    // set margin top for first page here, to not change the entire createPdfDoc functionality
    doc.moveDown(2);

    // add dataSets to doc
    dataSet.forEach(function (recordSet, index) {
      // store reset locations (x,y before adding contact info)
      const resetY = doc.y;
      const resetX = doc.x;

      // Add contact information at the start of each page
      pdfUtils.addTitle(doc, recordSet.contactInformation.title, 14);
      recordSet.contactInformation.rows.forEach(function (row) {
        doc.text(row);
      });

      // add follow up status legend to the right side of the page (reduce whitespace)
      doc.x = parseInt(doc.page.width / 2);
      doc.y = resetY;

      pdfUtils.addTitle(doc, recordSet.legend.title, 14);
      recordSet.legend.rows.forEach(function (row) {
        doc.text(row);
      });

      // reset x
      doc.x = resetX;
      doc.moveDown(3);

      // Add the follow-up table
      pdfUtils.createTableInPDFDocument(recordSet.headers, recordSet.data, doc);

      // if this is not the last record on in the last dataSet, add a new page for the next record
      if (!lastSet || index < dataSet.length - 1) {
        // Add a new page for every contact
        doc.addPage();
      }
    });
    // after finishing adding data to the doc, inform client that the worker is ready for the next batch
    process.send([null, {readyForNextBatch: true}]);
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

process.on('message', function (message) {
  worker[message.fn](...message.args);
});
