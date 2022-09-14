'use strict';

const PdfKit = require('pdfkit');
const PdfTable = require('voilab-pdf-table');
const streamUtils = require('./streamUtils');
const _ = require('lodash');

// PDF mime type
const MIME_TYPE = 'application/pdf';

// standard number of underline characters to be used when displaying labels without values
const STANDARD_UNDERLINE_COUNT = 40;

// standard title font size
const STANDARD_PAGE_TITLE = 20;

// maximum number of nested questions allowed
const MAX_QUESTIONS_LEVEL = 4;

// labels (label name: value) line gap
// mainly used in displaying sections and resource labels functions
const LABEL_LINE_GAP = 0.3;

// define a default document configuration
const defaultDocumentConfiguration = {
  size: 'A4',
  // manually add first page (to be intercepted by our hooks)
  autoFirstPage: false,
  layout: 'landscape',
  widthForPageSize: 841,
  margin: 30,
  fontSize: 8,
  lineWidth: 1,
  compress: false
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
    this.font(`${__dirname}/../resources/fonts/Inter-Regular.woff`);
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

  // create table in document
  createTableInPDFDocument(headers, data, document, documentConfig);

  // convert document stream to buffer
  streamUtils.streamToBuffer(document, callback);
  // finalize document
  document.end();
}

/**
 * Helper function used to add a text (title in most cases) with a given font size
 * @param doc
 * @param title
 * @param fontSize
 * @param position
 */
const addTitle = function (doc, title, fontSize, position) {
  position = position || {};
  position.x = position.x || doc.x;
  position.y = position.y || doc.y;

  let oldFontSize = doc._fontSize;
  doc.fontSize(fontSize || STANDARD_PAGE_TITLE);
  doc.text(title, position.x, position.y);
  doc.fontSize(oldFontSize).moveDown(0.5);
};

/**
 * Add questions pages in a existing pdf
 * Questions are added in separate pages
 * Optionally a title can be added
 * @param title
 * @param doc
 * @param questions
 * @param options
 */
const createQuestionnaire = function (doc, questions, withData, title, options) {
  options = options || {};
  options.underlineCount = options.underlineCount || 25;
  options.titleSize = options.titleSize || STANDARD_PAGE_TITLE;
  options.titlePosition = options.titlePosition || {};

  // cache initial document margin
  const initialXMargin = doc.x;

  // add questionnaire page title
  if (title) {
    addTitle(doc, title, options.titleSize, options.titlePosition);
  }
  doc.x = initialXMargin;

  // questionnaire
  doc.moveDown(2);

  // recursively insert each question and their answers into the document
  (function addQuestions(questions, margin, level) {
    questions.forEach((item) => {
      if (level > MAX_QUESTIONS_LEVEL) {
        return;
      }

      let questionMargin = initialXMargin;
      if (margin) {
        questionMargin = margin + 15;
      }

      // display type
      const displayVertical = item.answersDisplay === 'LNG_OUTBREAK_QUESTIONNAIRE_ANSWERS_DISPLAY_ORIENTATION_VERTICAL';

      // if this is a markup question, just display the text
      if (item.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP') {
        doc.moveDown().text(`${item.question}`, questionMargin);
        return;
      }

      // question test
      doc.moveDown().text(`${item.order}. ${item.question}`, questionMargin);

      if (item.multiAnswers) {
        item.multiAnswers.forEach((multiAnswer, index) => {
          const answerIndex = index + 1;

          // answers type are written differently into the doc
          switch (item.answerType) {
            default:
              doc.moveDown(0.5);
              if (withData) {
                if (multiAnswer.value) {
                  doc.text(`Answer ${answerIndex} (${multiAnswer.date}): ${multiAnswer.value}`, questionMargin);
                } else {
                  // in case the user did not answer this questions, we prevent printing 'undefined'
                  doc.text('Answer: ', questionMargin);
                }
              } else {
                doc.text(`Answer: ${'_'.repeat(options.underlineCount)}`, questionMargin);
              }
              doc.moveDown(0.5);
              break;
            // File uploads are not handled when printing a pdf
            case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD':
              break;
            case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER':
            case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS':
              // flag that indicates this is the first answer
              let firstAnswer = true;
              const getRectY = function (doc, displayVertical) {
                return displayVertical ? doc.y - 5 : doc.y;
              };

              let answerXMargin = questionMargin;

              // answers of type checkbox should be moved on line below
              // for text answers we use doc.text() that already moves one line below
              if (displayVertical) {
                doc.moveDown();
              } else {
                doc.moveDown(0.5);
              }

              let horizontalAnswerX = doc.x;

              doc.text(`Answer ${answerIndex} (${multiAnswer.date})`, questionMargin);
              doc.moveDown();

              multiAnswer.answers.forEach(answer => {
                if (!firstAnswer) {
                  if (displayVertical) {
                    doc.moveDown();
                  } else {
                    // horizontal gap between each answers
                    answerXMargin = horizontalAnswerX + 10;
                  }
                }

                let labelWidth = doc.widthOfString(answer.label);

                if (!displayVertical) {
                  const computedWidth = answerXMargin + labelWidth + 45;
                  // check that we don't reach the maximum width of the document
                  // otherwise pdfkit library just breaks when executing .text()
                  if (computedWidth > 500) {
                    answerXMargin = questionMargin;
                    doc.moveDown(1.5);
                  }
                }

                // calculate the checkbox height
                const rectY = getRectY(doc, displayVertical);

                // we need to reduce rectangle height to be on the same height as the text
                if (withData && answer.selected) {
                  doc
                    .rect(answerXMargin, rectY, 10, 10)
                    .moveTo(answerXMargin, rectY)
                    .lineTo(answerXMargin + 10, rectY + 10)
                    .moveTo(answerXMargin + 10, rectY)
                    .lineTo(answerXMargin, rectY + 10)
                    .stroke();
                } else {
                  doc.rect(answerXMargin, rectY, 10, 10).stroke();
                }

                doc.text(answer.label, answerXMargin + 15, rectY);
                horizontalAnswerX = answerXMargin + labelWidth + 15;
                doc.moveUp();

                if (displayVertical) {
                  doc.moveDown();
                }

                // handle additional questions
                if (answer.additionalQuestions.length) {
                  doc.moveDown(0.5);
                  addQuestions(answer.additionalQuestions, questionMargin, level + 1);
                }

                // no longer first questions
                firstAnswer = false;
              });

              // horizontal answers gap, after all the answers are displayed
              if (!displayVertical) {
                doc.moveDown();
              } else {
                doc.moveDown(0.5);
              }

              break;
          }
        });
      } else {
        // answers type are written differently into the doc
        switch (item.answerType) {
          default:
            doc.moveDown(0.5);
            if (withData) {
              if (item.value) {
                doc.text('Answer: ' + item.value, questionMargin);
              } else {
                // in case the user did not answer this questions, we prevent printing 'undefined'
                doc.text('Answer: ', questionMargin);
              }
            } else {
              doc.text(`Answer: ${'_'.repeat(options.underlineCount)}`, questionMargin);
            }
            doc.moveDown(0.5);
            break;
          // File uploads are not handled when printing a pdf
          case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD':
            break;
          case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER':
          case 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS':
            // flag that indicates this is the first answer
            let firstAnswer = true;
            const getRectY = function (doc, displayVertical) {
              return displayVertical ? doc.y - 5 : doc.y;
            };

            let answerXMargin = questionMargin;

            // answers of type checkbox should be moved on line below
            // for text answers we use doc.text() that already moves one line below
            if (displayVertical) {
              doc.moveDown();
            } else {
              doc.moveDown(0.5);
            }

            let horizontalAnswerX = doc.x;

            item.answers.forEach((answer) => {
              if (!firstAnswer) {
                if (displayVertical) {
                  doc.moveDown();
                } else {
                  // horizontal gap between each answers
                  answerXMargin = horizontalAnswerX + 10;
                }
              }

              let labelWidth = doc.widthOfString(answer.label);

              if (!displayVertical) {
                const computedWidth = answerXMargin + labelWidth + 45;
                // check that we don't reach the maximum width of the document
                // otherwise pdfkit library just breaks when executing .text()
                if (computedWidth > 500) {
                  answerXMargin = questionMargin;
                  doc.moveDown(1.5);
                }
              }

              // calculate the checkbox height
              const rectY = getRectY(doc, displayVertical);

              // we need to reduce rectangle height to be on the same height as the text
              if (withData && answer.selected) {
                doc
                  .rect(answerXMargin, rectY, 10, 10)
                  .moveTo(answerXMargin, rectY)
                  .lineTo(answerXMargin + 10, rectY + 10)
                  .moveTo(answerXMargin + 10, rectY)
                  .lineTo(answerXMargin, rectY + 10)
                  .stroke();
              } else {
                doc.rect(answerXMargin, rectY, 10, 10).stroke();
              }

              doc.text(answer.label, answerXMargin + 15, rectY);
              horizontalAnswerX = answerXMargin + labelWidth + 15;
              doc.moveUp();

              if (displayVertical) {
                doc.moveDown();
              }

              // handle additional questions
              if (answer.additionalQuestions.length) {
                doc.moveDown(0.5);
                addQuestions(answer.additionalQuestions, questionMargin, level + 1);
              }

              // no longer first questions
              firstAnswer = false;
            });

            // horizontal answers gap, after all the answers are displayed
            if (!displayVertical) {
              doc.moveDown();
            } else {
              doc.moveDown(0.5);
            }

            break;
        }
      }
    });
  })(questions, false, 0);

  return doc;
};

/**
 * Display a model's fields
 * Do not display actual values, only field names
 * DisplayValues flag is also supported, if true it will display the actual field values
 * This flag is needed to create empty profile pages
 * Optionally a title can be added
 * @param doc
 * @param model
 * @param displayValues
 * @param title
 * @param numberOfEmptyEntries
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
            } else if (typeof (item[prop]) === 'object' && item[prop] !== null) {
              doc.text(prop, initialXMargin + 20).moveDown();
              doc.x += 20;
              displayModelDetails(doc, item[prop], true);
            } else {
              doc.text(`${prop}: ${(item[prop] || item[prop] === 0 || item[prop] === false) ? item[prop] : ''}`, initialXMargin + 20).moveDown();
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
    } else if (typeof (model[fieldName]) === 'object' && model[fieldName] !== null && Object.keys(model[fieldName]).length) {
      doc.text(fieldName, initialXMargin).moveDown();
      doc.x += 20;
      displayModelDetails(doc, model[fieldName], true);
    } else {
      doc.text(`${fieldName}: ${displayValues ? ((model[fieldName] || model[fieldName] === 0 || model[fieldName] === false) ? model[fieldName] : '') : '_'.repeat(50)}`, initialXMargin).moveDown();
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
 * @param questionnaireTitle
 */
const displayPersonSectionsWithQuestionnaire = function (doc, sections, title, questionnaireTitle) {
  if (sections && Array.isArray(sections)) {
    sections.forEach((section) => {
      doc.addPage();
      displayModelDetails(doc, _.omit(section, 'questionnaire'), true, title);
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
 * @param [callback] If provided, data will be added in chunks
 */
function createTableInPDFDocument(headers, data, document, documentConfig, noHeaderOnNewPage, callback) {
  // sanitize data
  data = data.filter(row => row != null);
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

  // reset fill color after setting background as the fill color is used for all elements
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
      if (typeof (value) === 'boolean') {
        return value.toString();
      } else {
        return value;
      }
    });
  });

  // no callback provided, add data synchronously
  if (!callback) {
    // add table data
    pdfTable.addBody(data);
    // move cursor to next line and set margin
    document.moveDown();
    document.x = document.options.margin;
  } else {
    // callback provided, add data in chunks
    (function addDataInBatches(data, showHeaders = true) {
      // give the processor time between writes
      setImmediate(function () {
        // last chunk
        if (data.length === 0) {
          document.moveDown();
          document.x = document.options.margin;
          callback();
        } else {
          // data still left to be added
          pdfTable.showHeaders = showHeaders;
          // add 100 rows at a time
          pdfTable.addBody(data.slice(0, 100));
          // after first chunk, don't show headers
          addDataInBatches(data.slice(100), false);
        }
      });
    })(data);
  }
}

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

/**
 * Display a resource fields in sections
 * @param doc
 * @param sections
 * @param title
 * @param options
 */
const displaySections = function (doc, sections, title, options) {
  options = options || {};
  options.underlineCount = options.underlineCount || STANDARD_UNDERLINE_COUNT;
  options.titleSize = options.titleSize || STANDARD_PAGE_TITLE;
  options.titlePosition = options.titlePosition || {};
  options.lineGap = options.lineGap || LABEL_LINE_GAP;

  const initialXMargin = doc.x;

  // add page title
  if (title) {
    addTitle(doc, title, options.titleSize, options.titlePosition);
    doc.moveDown();
  }

  // cache initial document margin
  doc.x = initialXMargin;
  const labelStartWidth = initialXMargin + 20;

  // find the highest label width to align them property
  const gap = 20;
  let highestLabelWidth = 0;
  Object.keys(sections).forEach((section) => {
    if (sections[section].labels) {
      sections[section].labels.forEach((label) => {
        const estimatedWidth = doc.widthOfString(label);
        if (estimatedWidth > highestLabelWidth) {
          highestLabelWidth = estimatedWidth;
        }
      });
    }
  });

  /**
   * Display labels in pdf
   * @param labels
   * @param additionalTitles
   * @param copies
   */
  const displayLabels = (labels, additionalTitles = [], copies) => {
    copies = copies || 1;
    for (let i = 0; i < copies; i++) {
      doc.x = initialXMargin;

      if (additionalTitles[i]) {
        addTitle(doc, additionalTitles[i], 10);
      }
      labels.forEach((label) => {
        // if label is an object then we expect the following format ({ name, value})
        let labelName = label;
        let labelValue = null;

        if (typeof label === 'object') {
          labelName = label.name;
          labelValue = label.value;
        }

        const labelWidth = doc.widthOfString(labelName);
        const offsetWidth = highestLabelWidth - labelWidth;
        const labelHeight = doc.heightOfString(labelName);

        doc.text(labelName, labelStartWidth);
        doc.text(labelValue || '_'.repeat(options.underlineCount), labelStartWidth + labelWidth + gap + offsetWidth, doc.y - labelHeight);

        doc.moveDown(options.lineGap);
      });
      doc.moveDown();
    }
  };

  // display each field on a row
  Object.keys(sections).forEach((section) => {
    // reset X axis
    doc.x = initialXMargin;

    // add section title
    addTitle(doc, sections[section].title, 16);

    // display labels per section
    displayLabels(sections[section].labels, sections[section].additionalTitles || [], sections[section].copies);
  });

  return doc;
};

/**
 * Display a resource labels without any data
 * Align the label and continued dash lines
 * @param doc
 * @param labels
 * @param title
 * @param options
 */
const displayResourceLabels = function (doc, labels, title, options) {
  options = options || {};
  options.underlineCount = options.underlineCount || STANDARD_UNDERLINE_COUNT;
  options.titleSize = options.titleSize || STANDARD_PAGE_TITLE;
  options.titlePosition = options.titlePosition || {};
  options.lineGap = options.lineGap || LABEL_LINE_GAP;
  const initialXMargin = doc.x;

  // add page title
  if (title) {
    addTitle(doc, title, options.titleSize, options.titlePosition);
    doc.moveDown();
  }

  // cache initial document margin
  doc.x = initialXMargin;
  const labelStartWidth = initialXMargin;

  // find the highest label width, to align them property
  const gap = 20;
  let highestLabelWidth = 0;
  labels.forEach((label) => {
    const estimatedWidth = doc.widthOfString(label);
    if (estimatedWidth > highestLabelWidth) {
      highestLabelWidth = estimatedWidth;
    }
  });

  // display labels
  labels.forEach((label) => {
    const labelWidth = doc.widthOfString(label);
    const offsetWidth = highestLabelWidth - labelWidth;
    const labelHeight = doc.heightOfString(label);

    doc.text(label, labelStartWidth);
    doc.text('_'.repeat(options.underlineCount), labelStartWidth + labelWidth + gap + offsetWidth, doc.y - labelHeight);

    doc.moveDown(options.lineGap);
  });

  return doc;
};

/**
 * Either show years or months, never both
 * @param record
 * @param dictionary
 */
const displayAge = function (record, dictionary) {
  let age = '';
  let years = _.get(record, 'age.years', 0);
  let months = _.get(record, 'age.months', 0);
  if (months > 0) {
    age = `${displayValue(months)} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_MONTHS')}`;
  } else {
    age = `${displayValue(years)} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_YEARS')}`;
  }
  return age;
};

module.exports = {
  createPDFList: createPDFList,
  createPdfDoc: createPdfDoc,
  createQuestionnaire: createQuestionnaire,
  displayModelDetails: displayModelDetails,
  displayPersonRelationships: displayPersonRelationships,
  displayPersonSectionsWithQuestionnaire: displayPersonSectionsWithQuestionnaire,
  createTableInPDFDocument: createTableInPDFDocument,
  addTitle: addTitle,
  MIME_TYPE: MIME_TYPE,
  downloadPdfDoc: downloadPdfDoc,
  displayValue: displayValue,
  displaySections: displaySections,
  displayResourceLabels: displayResourceLabels,
  displayAge: displayAge
};
