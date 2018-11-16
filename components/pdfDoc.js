'use strict';

const PdfKit = require('pdfkit');
const PdfTable = require('voilab-pdf-table');
const streamUtils = require('./streamUtils');
const Jimp = require('jimp');
const _ = require('lodash');

// PDF mime type
const MIME_TYPE = 'application/pdf';

// define a default document configuration
const defaultDocumentConfiguration = {
  size: 'A4',
  // manually add first page (to be intercepted by our hooks)
  autoFirstPage: false,
  layout: 'landscape',
  widthForPageSize: 841,
  margin: 30,
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
  document.text('', 30, 50);
  // reset page bottom margin
  document.page.margins.bottom = bottomMargin;
}


/**
 * Create a (standard) PDF document
 * @param options
 */
function createPdfDoc(options) {
  // merge options
  options = Object.assign({}, defaultDocumentConfiguration, options);
  // create a PDF document
  const document = new PdfKit(options);
  // set logo on all pages and default line width
  document.on('pageAdded', function () {
    this.lineWidth(options.lineWidth);
    this.fontSize(options.fontSize);
    this.font(`${__dirname}/../resources/fonts/NotoSansCJKjp-Regular.min.ttf`);
    // include standard logo for non-border-less printing
    if (!options.borderLess) {
      this.image(`${__dirname}/../resources/images/logo-black.png`, document.options.margin, 15, {height: 25});
      addPageNumber(document);
    } else {
      // for border-less printing, add transparent logo on demand
      document.once('addTransparentLogo', function () {
        this.image(`${__dirname}/../resources/images/logo-black-transparent.png`, 15, 15, {height: 25});
        addPageNumber(document);
      });
    }
  });
  // add first page
  document.addPage(options);

  /**
   * Expose functionality to overlay transparent logo (useful for borderless printing)
   */
  document.addTransparentLogo = function () {
    this.emit('addTransparentLogo');
  };
  return document;
}

/**
 * Create a PDF list
 * @param headers
 * @param data
 * @param callback
 */
function createPDFList(headers, data, title, callback) {
  // default document config
  const documentConfig = {};

  // use different document sizes for different number of headers
  switch (true) {
    case headers.length <= 10:
      documentConfig.size = 'A4';
      documentConfig.widthForPageSize = 841;
      break;
    case headers.length > 10 && headers.length <= 20:
      documentConfig.size = 'A3';
      documentConfig.widthForPageSize = 1190;
      break;
    case headers.length > 20 && headers.length <= 30:
      documentConfig.size = 'A2';
      documentConfig.widthForPageSize = 1683;
      break;
    case headers.length > 30 && headers.length <= 40:
      documentConfig.size = 'A1';
      documentConfig.widthForPageSize = 2383;
      break;
    case headers.length > 40 && headers.length <= 50:
      documentConfig.size = 'A0';
      documentConfig.widthForPageSize = 3370;
      break;
    case headers.length > 50 && headers.length <= 60:
      documentConfig.size = '2A0';
      documentConfig.widthForPageSize = 4767;
      break;
    case headers.length > 60:
      documentConfig.size = '4A0';
      documentConfig.widthForPageSize = 6740;
      break;
  }

  const document = createPdfDoc(documentConfig);

  addTitle(document, title, 20);

  // add the questionnaire headers
  // since they depend on the translated data, we have to add them separately
  addQuestionnaireHeadersForPrint(data, headers);

  // create table in document
  createTableInPDFDocument(headers, data, document, documentConfig);

  // convert document stream to buffer
  streamUtils.streamToBuffer(document, callback);
  // finalize document
  document.end();
}

/**
 * Create a PDF file containing PNG images
 * @param imageData
 * @param splitFactor Split the image into:
 * - a nxm matrix computed based on the provided image size
 * - a square matrix with a side of <splitFactor> (1 no split, 2 => 2x2 grid, 3 => 3x3 grid) when splitType is grid
 * - a list of <splitFactor> images, divided horizontally when splitType is horizontal
 * - a list of <splitFactor> images, divided vertically when splitType is vertical
 * @param splitType enum: ['auto', grid', 'horizontal', 'vertical']. Default 'auto'.
 * @param callback
 */
const createImageDoc = function (imageData, splitFactor, splitType, callback) {

  // define supported split types
  const splitTypes = {
    horizontal: 'horizontal',
    vertical: 'vertical',
    grid: 'grid',
    auto: 'auto'
  };

  // make sure the split type is one of the supported ones
  splitType = splitTypes[splitType];
  // default split type is auto
  if (!splitType) {
    splitType = splitTypes.auto;
  }

  /**
   * Get PNG image buffer from base64 encoded content
   * @param base64content
   * @return {Promise<any>}
   */
  function getPNGImageBuffer(base64content) {
    return new Promise(function (resolve) {
      resolve(Buffer.from(base64content, 'base64'));
    });
  }

  // create a PDF doc
  const document = createPdfDoc({
    borderLess: true,
    size: 'A3'
  });

  // image size is A3 page - margins
  const imageSize = {
    width: 1190,
    height: 840
  };

  // default splitFactor is 1
  if (!splitFactor || splitFactor < 1) {
    splitFactor = 1;
  } else {
    // splitFactor is always integer
    splitFactor = parseInt(splitFactor);
  }

  // when done, send back document buffer
  streamUtils.streamToBuffer(document, callback);

  getPNGImageBuffer(imageData)
    .then(function (buffer) {
      // load the image into Jimp
      Jimp.read(buffer)
        .then(function (image) {
          // handle errors
          if (!image) {
            return callback(new Error('Unknown image format.'));
          }

          // compute page and image aspect ratio
          const pageAspectRatio = imageSize.width / imageSize.height;
          const imageAspectRatio = image.bitmap.width / image.bitmap.height;

          // if the image is wider than page (proportionally)
          if (imageAspectRatio > pageAspectRatio) {
            // resize its width according to the split factor
            image.resize(imageSize.width * splitFactor, Jimp.AUTO);
          } else {
            // otherwise resize its height according to the split factor
            image.resize(Jimp.AUTO, imageSize.height * splitFactor);
          }
          // compute width, height, rows and columns
          let width, height, rows, columns;

          // for split type auto, decide automatically how many pages to create
          if (splitType === splitTypes.auto) {
            // compute how many columns and rows are needed based on image dimensions
            columns = Math.ceil(image.bitmap.width / imageSize.width);
            rows = Math.ceil(image.bitmap.height / imageSize.height);
            // the width and height match page dimension
            width = imageSize.width;
            height = imageSize.height;

          } else {
            // decide image height and number of rows based on split type
            if ([splitTypes.grid, splitTypes.vertical].includes(splitType)) {
              height = image.bitmap.height / splitFactor;
              rows = splitFactor;
            } else {
              height = image.bitmap.height;
              rows = 1;
            }

            // decide image width and number of columns based on split type
            if ([splitTypes.grid, splitTypes.horizontal].includes(splitType)) {
              width = image.bitmap.width / splitFactor;
              columns = splitFactor;
            } else {
              width = image.bitmap.width;
              columns = 1;
            }
          }

          // store image parts
          let images = [];

          // build a matrix of images, each cropped to its own position in the matrix
          for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
              let processedHeight = row * height;
              let processedWidth = column * width;
              // calculate crop size and position
              let cropWidth = Math.min(Math.max(0, image.bitmap.width - processedWidth), width);
              let cropHeight = Math.min(Math.max(0, image.bitmap.height - processedHeight), height);
              // if something was cropped, add it to the list of images
              if (cropWidth && cropHeight) {
                images.push(
                  image
                    .clone()
                    .crop(
                      processedWidth,
                      processedHeight,
                      cropWidth,
                      cropHeight
                    )
                );
              }
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
                document.image(buffer, 0, 0, {fit: [imageSize.width, imageSize.height]});
                // overlay transparent logo
                document.addTransparentLogo();
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
        });
    })
    .catch(callback);
};

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
const createQuestionnaire = function (doc, questions, withData, title) {
  // cache initial document margin
  const initialXMargin = doc.x;

  // add questionnaire page title
  if (title) {
    addTitle(doc, title, 14);
  }

  // recursively insert each question and their answers into the document
  (function addQuestions(questions, isNested) {
    questions.forEach((item) => {
      doc.moveDown(1).text(`${item.order}. ${item.question}`, isNested ? initialXMargin + 40 : initialXMargin);

      // answers type are written differently into the doc
      switch (item.answerType) {
        default:
          if (withData) {
            if (item.value) {
              doc.moveDown().text('Answer: ' + item.value, isNested ? initialXMargin + 60 : initialXMargin + 20);
            } else {
              // In case the user did not answer this questions, we prevent printing 'undefined'
              doc.moveDown().text('Answer: ', isNested ? initialXMargin + 60 : initialXMargin + 20);
            }
          } else {
            doc.moveDown().text(`Answer: ${'_'.repeat(50)}`, isNested ? initialXMargin + 60 : initialXMargin + 20);
          }
          break;
        // File uploads are not handled when printing a pdf
        case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD':
          break;
        case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER':
        case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS':
          // NOTE: only first nested level is handled for additional questions
          item.answers.forEach((answer) => {
            doc.moveDown().text(answer.label, isNested ? initialXMargin + 85 : initialXMargin + 45);
            // we need to reduce rectangle height to be on the same height as the text
            if (withData && answer.selected) {
              doc.moveUp()
                .rect(isNested ? initialXMargin + 60 : initialXMargin + 20, doc.y - 3, 15, 15)
                .moveTo(isNested ? initialXMargin + 60 : initialXMargin + 20, doc.y - 3)
                .lineTo(isNested ? initialXMargin + 60 + 15 : initialXMargin + 20 + 15, doc.y - 3 + 15)
                .moveTo(isNested ? initialXMargin + 60 + 15 : initialXMargin + 20 + 15, doc.y - 3)
                .lineTo(isNested ? initialXMargin + 60 : initialXMargin + 20, doc.y - 3 + 15)
                .stroke()
                .moveDown();
            } else {
              doc.moveUp().rect(isNested ? initialXMargin + 60 : initialXMargin + 20, doc.y - 3, 15, 15).stroke().moveDown();
            }

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
 * Display a model's fields
 * Do not display actual values, only field names
 * DisplayValues flag is also supported, if true it will display the actual field values
 * This flag is needed to create empty profile pages
 * Optionally a title can be added
 * @param doc
 * @param person
 * @param displayValues
 * @param title
 */
const displayModelDetails = function (doc, model, displayValues, title, numberOfEmptyEntries) {
  numberOfEmptyEntries = numberOfEmptyEntries || 2;

  // add page title
  if (title) {
    addTitle(doc, title, 14);
    doc.moveDown();
  }

  // cache initial document margin
  const initialXMargin = doc.x;

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

        // list of empty entries to add
        let emptyEntries = new Array(numberOfEmptyEntries);
        emptyEntries.fill(fields);

        // number of empty entries to set
        emptyEntries.forEach((fields, index, arr) => {
          fields.forEach((field) => {
            doc.text(`${field}: ${'_'.repeat(50)}`, initialXMargin + 20).moveDown();
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
            if (Array.isArray(item[prop])) {
              item.prop.forEach((subItem) => {
                doc.text(prop, initialXMargin + 20).moveDown();
                doc.x += 20;
                displayModelDetails(doc, subItem, true);
                doc.x = initialXMargin + 20;
              });
            } else if (typeof(item[prop]) === 'object' && item[prop] !== null) {
              doc.text(prop, initialXMargin + 20).moveDown();
              doc.x += 20;
              displayModelDetails(doc, item[prop], true);
            } else {
              doc.text(`${prop}: ${item[prop]}`, initialXMargin + 20).moveDown();
            }
          });

          // space after each item in the list
          // if this is the last item do not move 2 lines
          if (index !== arr.length - 1) {
            doc.moveDown(2);
          }
        });
      }

      // reset margin
      doc.x = initialXMargin;
    } else if (typeof(model[fieldName]) === 'object' && model[fieldName] !== null && Object.keys(model[fieldName]).length) {
      doc.text(fieldName, initialXMargin).moveDown();
      doc.x += 20;
      displayModelDetails(doc, model[fieldName], true);
    } else {
      doc.text(`${fieldName}: ${displayValues ? model[fieldName] : '_'.repeat(50)}`, initialXMargin).moveDown();
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
  if (relationships && Array.isArray(relationships)) {
    relationships.forEach((relationship, index) => {
      doc.addPage();
      displayModelDetails(doc, relationship, true, index === 0 ? title : null);
    });
  }
};

/**
 * Display a case's lab results
 * @param doc
 * @param sections
 * @param title
 */
const displayPersonSectionsWithQuestionnaire = function (doc, sections, title, questionnaireTitle) {
  if (sections && Array.isArray(sections)) {
    sections.forEach((section, index) => {
      doc.addPage();
      displayModelDetails(doc, _.omit(section, 'questionnaire'), true, index === 0 ? title : null);
      if (section.questionnaire && section.questionnaire.length) {
        doc.addPage();
        createQuestionnaire(doc, section.questionnaire, true, questionnaireTitle);
      }
    });
  }
};

/**
 * Create a table in a PDF document
 * @param headers Table headers
 * @param data Table data
 * @param document PDF document in which to add table
 * @param documentConfig Optional configuration
 * @param noHeaderOnNewPage
 */
function createTableInPDFDocument(headers, data, document, documentConfig, noHeaderOnNewPage) {
  documentConfig = documentConfig || defaultDocumentConfiguration;

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
    if (!noHeaderOnNewPage) {
      tb.addHeader();
    }
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
  const defaultRowWidth = (documentConfig.widthForPageSize - 2 * document.options.margin - reservedWidth) / (headers.length - noHeadersWithReservedWidth);

  // add all headers
  headers.forEach(function (header) {
    pdfTable.addColumn({
      id: header.id,
      header: header.header,
      width: header.width || defaultRowWidth
    });
  });

  // Transform boolean values into string, otherwise false does not get printed
  data.forEach((model, index) => {
    data[index] = _.mapValues(model, (value) => {
      if (typeof(value) === 'boolean') {
        return value.toString();
      } else {
        return value;
      }
    });
  });

  // add table data
  pdfTable.addBody(data);
  // move cursor to next line and set margin
  document.moveDown();
  document.x = document.options.margin;
}

/**
 * Create questionnaire headers for flat file export. Added here since we cannot require helpers in this file because of
 * circular dependency
 * @param data
 * @param headers
 */
const addQuestionnaireHeadersForPrint = function (data, headers) {
  return require('./helpers').addQuestionnaireHeadersForPrint(data, headers);
};

// convert a document into a binary buffer
// send it over the network
const downloadPdfDoc = function (document, filename, callback) {
  const app = require('../server/server');

  // convert pdf stream to buffer and send it as response
  streamUtils.streamToBuffer(document, (err, buffer) => {
    if (err) {
      return callback(err);
    }

    // serve the file as response
    app.utils.remote.helpers.offerFileToDownload(
      buffer,
      MIME_TYPE,
      `${filename}.pdf`,
      callback
    );
  });
};

/**
 * Safely display a value in the document
 * In case value is undefined/null fallback to empty string
 * @param value
 */
const displayValue = function (value) {
  return (typeof value === 'undefined' || value === null) ? '' : value;
};

module.exports = {
  createPDFList: createPDFList,
  createImageDoc: createImageDoc,
  createPdfDoc: createPdfDoc,
  createQuestionnaire: createQuestionnaire,
  displayModelDetails: displayModelDetails,
  displayPersonRelationships: displayPersonRelationships,
  displayPersonSectionsWithQuestionnaire: displayPersonSectionsWithQuestionnaire,
  createTableInPDFDocument: createTableInPDFDocument,
  addTitle: addTitle,
  MIME_TYPE: MIME_TYPE,
  downloadPdfDoc: downloadPdfDoc,
  displayValue: displayValue
};
