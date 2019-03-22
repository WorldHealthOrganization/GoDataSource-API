'use strict';

// dependencies
const PdfUtils = require('../pdfDoc');

// A3 page - margins
const pageSize = {
  width: 1190,
  height: 840
};

// create the document
const doc = PdfUtils.createPdfDoc({
  borderLess: true,
  size: 'A3'
});

const worker = {
  /**
   * Add new image into the PDF
   * @param data
   */
  addImage(data) {
    const buffer = Buffer.from(data.base64, 'base64');

    // we add one image per page, first page is created by default when document is created
    if (doc.pageNumber !== 1) {
      doc.addPage();
    }

    // store it in the document (fit to document size - margins)
    doc.image(buffer, 0, 0, {fit: [pageSize.width, pageSize.height]});

    // overlay transparent logo
    doc.addTransparentLogo();

    // after finishing adding data to the doc, inform client that the worker is ready for the next batch of data
    process.send([null, { ready: true }]);
  },
  // close the PDF stream
  finish() {
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
