'use strict';

const PdfKit = require('pdfkit');
const PdfTable = require('voilab-pdf-table');
const helpers = require('./helpers');

// define a default document configuration
const defaultDocumentConfiguration = {
  size: 'A4',
  // manually add first page (to be intercepted by our hooks)
  autoFirstPage: false,
  layout: 'landscape',
  widthForPageSize: 841,
  margin: 50,
  fontSize: 8,
  lineWidth: 1
};

/**
 * Create a (standard) PDF document
 * @param options
 * @return {PDFDocument}
 */
function createPdfDoc(options) {
  // create a PDF document
  const document = new PdfKit(Object.assign({}, defaultDocumentConfiguration, options));
  // set logo on all pages and default line width
  document.on('pageAdded', function () {
    this.image(`${__dirname}/../resources/images/logo-black.png`, 50, 15, {height: 25});
    this.lineWidth(defaultDocumentConfiguration.lineWidth);
    this.fontSize(defaultDocumentConfiguration.fontSize);
  });
  // add first page
  document.addPage(defaultDocumentConfiguration);
  return document;
}

/**
 * Create a PDF list
 * @param headers
 * @param data
 * @param callback
 */
function createPDFList(headers, data, callback) {
  const document = createPdfDoc();
  const pdfTable = new PdfTable(document);

  // set default values for columns
  pdfTable.setColumnsDefaults({
    headerBorder: 'B',
    align: 'left',
    headerPadding: [2],
    padding: [2],
    fill: true
  });

  // alternate background on rows
  pdfTable.onCellBackgroundAdd(function (table, column, row, index) {
    if (index % 2 === 0) {
      table.pdf.fillColor('#ececec');
    } else {
      table.pdf.fillColor('#ffffff');
    }
  });

  // reset fill color after setting backround as the fill color is used for all elements
  pdfTable.onCellBackgroundAdded(function (table) {
    table.pdf.fillColor('#000000');
  });

  // add table header on all pages
  pdfTable.onPageAdded(function (tb) {
    tb.addHeader();
  });

  // compute width
  let reservedWith = 0;
  let noHeadersWithReservedWidth = 0;
  // find headers which need specific width
  headers.forEach(function (header) {
    if (header.width) {
      // mark width as reserved
      reservedWith += header.width;
      // count the number of headers with reserved width
      noHeadersWithReservedWidth++;
    }
  });

  // for rows without reserved width, split remaining document width (doc width - margins - reserved width) between remaining headers
  const defaultRowWidth = (defaultDocumentConfiguration.widthForPageSize - 2 * defaultDocumentConfiguration.margin - reservedWith) / (headers.length - noHeadersWithReservedWidth);

  // add all headers
  headers.forEach(function (header) {
    pdfTable.addColumn({
      id: header.id,
      header: header.header,
      width: header.width || defaultRowWidth
    })
  });

  // add table data
  pdfTable.addBody(data);
  // convert document stream to buffer
  helpers.streamToBuffer(document, callback);
  // finalize document
  document.end();
}

module.exports = {
  createPDFList: createPDFList
};
