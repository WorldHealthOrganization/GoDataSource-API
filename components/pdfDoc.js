'use strict';

const PdfKit = require('pdfkit');
const PdfTable = require('voilab-pdf-table');
const svg2png = require('svg2png');
const helpers = require('./helpers');
const Jimp = require('jimp');
const _ = require('lodash');

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
 * Add page number
 * @param document
 */
function addPageNumber(document) {
  // init page number
  if (document.pageNumber === undefined) {
    document.pageNumber = 0;
  }
  // start from page 1
  document.pageNumber++;
  // get initial bottom margin
  const bottomMargin = document.page.margins.bottom;
  // set bottom margin to 0, so we can write on the margins
  document.page.margins.bottom = 0;
  // add page number to bottom-right corner
  document.text(
    document.pageNumber,
    document.page.width - 100,
    document.page.height - 35,
    {
      width: 100,
      align: 'center',
      lineBreak: false,
    });
  // Reset text writer position
  document.text('', 50, 50);
  // reset page bottom margin
  document.page.margins.bottom = bottomMargin;
}


/**
 * Create a (standard) PDF document
 * @param options
 * @return {PDFDocument}
 */
function createPdfDoc(options) {
  // merge options
  options = Object.assign({}, defaultDocumentConfiguration, options);
  // create a PDF document
  const document = new PdfKit(options);
  // set logo on all pages and default line width
  document.on('pageAdded', function () {
    this.image(`${__dirname}/../resources/images/logo-black.png`, 50, 15, {height: 25});
    this.lineWidth(options.lineWidth);
    this.fontSize(options.fontSize);
    addPageNumber(document);
  });
  // add first page
  document.addPage(options);
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
  let reservedWidth = 0;
  let noHeadersWithReservedWidth = 0;
  // find headers which need specific width
  headers.forEach(function (header) {
    if (header.width) {
      // mark width as reserved
      reservedWidth += header.width;
      // count the number of headers with reserved width
      noHeadersWithReservedWidth++;
    }
  });

  // for rows without reserved width, split remaining document width (doc width - margins - reserved width) between remaining headers
  const defaultRowWidth = (defaultDocumentConfiguration.widthForPageSize - 2 * defaultDocumentConfiguration.margin - reservedWidth) / (headers.length - noHeadersWithReservedWidth);

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

/**
 * Create a PDF file containing PNG images coming from SVG files
 * @param svgData
 * @param splitFactor Split the image into a square matrix with a side of splitFactor (1 no split, 2 => 2x2 grid, 3 => 3x3 grid)
 * @param callback
 */
function createSVGDoc(svgData, splitFactor, callback) {
  // create a PDF doc
  const document = createPdfDoc({size: 'A3'});

  // image size is A3 page - margins
  const imageSize = {
    width: 1090,
    height: 740
  };

  // render the image at 120% resolution of the page (make the image sharper)
  const renderImageSize = {
    width: imageSize.width * 1.2,
    height: imageSize.height * 1.2
  };

  // default splitFactor is 1
  if (!splitFactor || splitFactor < 1) {
    splitFactor = 1;
  } else {
    // splitFactor is always integer
    splitFactor = parseInt(splitFactor);
  }

  // when done, send back document buffer
  helpers.streamToBuffer(document, callback);
  // render a PNG from a SVG at a resolution of a rendered image, multiplied by the split factor
  svg2png(svgData, {width: renderImageSize.width * splitFactor, height: renderImageSize.height * splitFactor})
    .then(function (buffer) {
      // check if we need to split the image
      if (splitFactor > 1) {
        // load the image into Jimp
        Jimp.read(buffer)
          .then(function (image) {
            // store image parts
            let images = [];
            // build a matrix of images, each cropped to its own position in the matrix
            for (let row = 0; row < splitFactor; row++) {
              for (let column = 0; column < splitFactor; column++) {
                images.push(image.clone().crop(column * renderImageSize.width, row * renderImageSize.height, renderImageSize.width, renderImageSize.height));
              }
            }
            // keep a flag for first image (first page is auto-added, we don't want to add it twice)
            let firstImage = true;

            /**
             * Add images to PDF doc
             * @param done
             */
            function writeImageToPage(done) {
              // get first image from the queue
              const image = images.shift();
              // if the image is a valid one
              if (image) {
                // if this is the first image added, do not add a new page
                if (!firstImage) {
                  document.addPage();
                }
                firstImage = false;
                // get image buffer
                image.getBuffer(Jimp.MIME_PNG, function (error, buffer) {
                  if (error) {
                    return done(error);
                  }
                  // store it in the document (fit to document size - margins)
                  document.image(buffer, 50, 50, {fit: [imageSize.width, imageSize.height]});
                  // move to the next page
                  writeImageToPage(done);
                });
              } else {
                // no more images to add, move along
                done();
              }
            }
            // write images to pdf
            writeImageToPage(function (error) {
              if (error) {
                return callback(error);
              }
              // finalize document
              document.end();
            });
          })
      } else {
        // fit the image to page (page dimensions - margins)
        document.image(buffer, 50, 50, {fit: [imageSize.width, imageSize.height]});
        // finalize document
        document.end();
      }
    })
    .catch(callback);
}

/**
 * Helper function used to add a text (title in most cases) with a given font size
 * @param doc
 * @param title
 * @param fontSize
 */
const addTitle = function (doc, title, fontSize) {
  let oldFontSize = doc._fontSize;
  doc.fontSize(fontSize || 20);
  doc.text(title);
  doc.fontSize(oldFontSize).moveDown(0.5);
};

/**
 * Add questions pages in a existing pdf
 * Questions are added in separate pages
 * Optionally a title can be added
 * @param title
 * @param doc
 * @param questions
 */
const createQuestionnaire = function (doc, questions, title) {
  // cache initial document margin
  const initialXMargin = doc.x;

  // add questionnaire page title
  if (title) {
    addTitle(doc, title);
  }

  // recursively insert each question and their answers into the document
  (function addQuestions(questions, isNested) {
    questions.forEach((item) => {
      doc.moveDown(1).text(`${item.order}. ${item.question}`, isNested ? initialXMargin + 40 : initialXMargin);

      // answers type are written differently into the doc
      switch (item.answerType) {
        case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FREE_TEXT':
          doc.moveDown().text(`Answer: ${'_'.repeat(25)}`, isNested ? initialXMargin + 60 : initialXMargin + 20);
          break;
        default:
          // NOTE: only first nested level is handled for additional questions
          item.answers.forEach((answer) => {
            doc.moveDown().text(answer.label, isNested ? initialXMargin + 85 : initialXMargin + 45, doc.y + 8);
            doc.moveUp().rect(isNested ? initialXMargin + 60 : initialXMargin + 20, doc.y, 13, 13).stroke().moveDown();

            // handle additional questions
            if (answer.additionalQuestions.length) {
              addQuestions(answer.additionalQuestions, true);
            }
          });
          break;
      }
    });
  })(questions);

  return doc;
};

/**
 * Display a person specific fields
 * Do not display actual values, only field names
 * DisplayValues flag is also supported, if true it will display the actual field values
 * This flag is needed to create empty profile pages
 * Optionally a title can be added
 * @param doc
 * @param person
 * @param displayValues
 * @param title
 */
const displayModelDetails = function (doc, model, displayValues, title) {
  // add page title
  if (title) {
    addTitle(doc, title);
    doc.moveDown();
  }

  // cache initial document margin
  if (!initialXMargin) {
    var initialXMargin = doc.x;
  };

  // display each field on a row
  Object.keys(model).forEach((fieldName) => {
    // if property is array and has at least one element, display it on next page
    if (Array.isArray(model[fieldName]) && model[fieldName][0]) {
      // top property
      doc.text(fieldName, initialXMargin).moveDown();

      // if this should be an empty form, display 2 entries of it
      if (!displayValues) {
        // there will always be an element in the array, containing field definitions
        let fields = Object.keys(model[fieldName][0]);

        [fields, fields].forEach((fields, index, arr) => {
          fields.forEach((field) => {
            doc.text(`${field}: ${'_'.repeat(25)}`, initialXMargin + 20).moveDown();
          });

          // separate each group of fields
          // if this is the last item do not move 2 lines
          if (index !== arr.length - 1) {
            doc.moveDown(2);
          }
        });
      } else {
        // display nested props
        model[fieldName].forEach((item, index, arr) => {
          Object.keys(item).forEach((prop) => {
            doc.text(`${prop}: ${item[prop]}`, initialXMargin + 20).moveDown();
          });

          // space after each item in the list
          // if this is the last item do not move 2 lines
          if (index !== arr.length - 1) {
            doc.moveDown(2);
          }
        });
      }
    } else if (typeof(model[fieldName]) === 'object' && Object.keys(model[fieldName]).length) {
      doc.text(fieldName, initialXMargin).moveDown();
      doc.x += 20;
      displayModelDetails(doc, model[fieldName], true);
    } else {
      doc.text(`${fieldName}: ${displayValues ? model[fieldName] : '_'.repeat(25)}`, initialXMargin).moveDown();
    }
  });

  return doc;
};

/**
 * Display a case/contact's relationships
 * @param doc
 * @param relationships
 * @param title
 */
const displayPersonRelationships = function (doc, relationships, title) {
  relationships.forEach((relationship, index) => {
    doc.addPage();
    displayModelDetails(doc, relationship, true, index === 0 ? title : null)
  });
};

/**
 * Display a case's lab results
 * @param doc
 * @param labResults
 * @param title
 */
const displayCaseLabResults = function (doc, labResults, title) {
  labResults.forEach((labResult, index) => {
    doc.addPage();
    displayModelDetails(doc, labResult, true, index === 0 ? title : null)
  });
};

module.exports = {
  createPDFList: createPDFList,
  createSVGDoc: createSVGDoc,
  createPdfDoc: createPdfDoc,
  displayModelDetails: displayModelDetails,
  displayPersonRelationships: displayPersonRelationships,
  displayCaseLabResults: displayCaseLabResults
};
