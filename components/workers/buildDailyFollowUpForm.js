'use strict';

// dependencies
const PdfUtils = require('../pdfDoc');

// create the document
const doc = PdfUtils.createPdfDoc({
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
   * @param data
   * @param isLastSubset
   */
  sendData: function (commonLabels, data, isLastSubset = false) {
    data.forEach((entry, index) => {
      // add title to each page
      PdfUtils.addTitle(doc, commonLabels.pageTitle);

      // cache initial document margin
      const initialXMargin = doc.x;

      // move down a line after the title
      doc.moveDown();

      // add additional information at the start of each page
      PdfUtils.addTitle(doc, commonLabels.contactTitle, 14);
      entry.contactDetails.forEach((entry) => {
        doc.text(`${entry.label}: ${PdfUtils.displayValue(entry.value)}`);
      });

      // add 2 empty lines before displaying the table
      doc.moveDown(2);

      // add the symptoms/follow-up table
      PdfUtils.createTableInPDFDocument(entry.tableHeaders, entry.tableData, doc);

      // comments area
      doc.x = initialXMargin;
      PdfUtils.addTitle(doc, commonLabels.commentsTitle, 12);
      doc.moveDown(2);

      // add only a contact per page
      if (!isLastSubset || index < data.length - 1) {
        doc.addPage();
      }
    });

    // after finishing adding data to the doc, inform client that the worker is ready for the next batch
    process.send([null, { readyForNextBatch: true }]);
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
    process.send([null, { chunk: Buffer.concat(buffers) }]);
    buffers = [];
  }
  // if doc finished
  if (end) {
    // inform the client
    process.send([null, { end: true }]);
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
