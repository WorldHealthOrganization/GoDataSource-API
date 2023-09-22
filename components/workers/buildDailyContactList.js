'use strict';

// dependencies
const PdfUtils = require('../pdfDoc');
const localizationHelper = require('../localizationHelper');
const Async = require('async');

// format for follow up column dates ids
const FOLLOWUP_DATE_ID_FORMAT = 'YYYY-MM-DD';

/**
 * Build table for a contact entry
 * @param headers
 * @param partialRecord
 * @param followUpStatusMap
 @returns {{headers: , data: [null]}}
 */
const buildTableForContact = function (headers, partialRecord, followUpStatusMap) {
  // additional tables for many days
  let additionalTables = [];
  // allow only 10 days be displayed on the same table with contact information
  let mainTableMaxCount = 24;
  // check to know that main table count threshold is overcome
  let isMainTableFull = false;
  // allow only 20 days per additional table to be displayed
  let additionalTableMaxCount = 39;
  let counter = 1;
  let insertAdditionalTable = function () {
    additionalTables.push({
      headers: [],
      values: []
    });
  };

  // they are already sorted by index (reflection of date of follow up)
  // build follow up period + adjacent dates that are out of period
  const contactFollowUpProps = partialRecord.followUp;
  const startDate = localizationHelper.getDateStartOfDay(contactFollowUpProps.startDate);
  const endDate = localizationHelper.getDateEndOfDay(contactFollowUpProps.endDate);
  for (let date = startDate.clone(); date.isSameOrBefore(endDate); date.add(1, 'day')) {
    let existingFollowUps = partialRecord.followUps.find((followUp) => localizationHelper.toMoment(followUp.date).isSame(date, 'day'));
    if (!existingFollowUps) {
      // build a fake follow up entry, used only when displaying in the table
      partialRecord.followUps.push({
        date: date.clone()
      });
    }
  }

  // resort follow ups by date
  partialRecord.followUps = partialRecord.followUps.sort((left, right) => localizationHelper.now().utc(left.date).diff(localizationHelper.now().utc(right.date)));

  partialRecord.followUps.forEach((followUp) => {
    let date = localizationHelper.toMoment(followUp.date);

    // create a formatted date
    const formattedDate = date.format(FOLLOWUP_DATE_ID_FORMAT);

    partialRecord[formattedDate] = {
      value: followUpStatusMap[followUp.statusId] || '',
      isDate: true
    };

    if (counter <= mainTableMaxCount && !isMainTableFull) {
      headers.push({
        id: date.format(FOLLOWUP_DATE_ID_FORMAT),
        header: date.format('YY/MM/DD'),
        width: 20,
        isDate: true
      });

      if (counter === mainTableMaxCount) {
        isMainTableFull = true;
        counter = 1;
        return;
      }
    }

    if (counter <= additionalTableMaxCount && isMainTableFull) {
      if (!additionalTables.length) {
        insertAdditionalTable();
      }

      let lastAdditionalTable = additionalTables[additionalTables.length - 1];
      lastAdditionalTable.headers.push({
        id: date.format(FOLLOWUP_DATE_ID_FORMAT),
        header: date.format('YY/MM/DD'),
        width: 20
      });

      if (counter === additionalTableMaxCount) {
        insertAdditionalTable();
        counter = 1;
        return;
      }
    }

    counter++;
  });

  // no longer needed in memory
  delete partialRecord.followUps;

  // move days that don't belong to main table to additional day tables
  let mainTableDateHeaders = headers.filter((header) => header.hasOwnProperty('isDate'));
  if (mainTableDateHeaders.length) {
    let lastDayInMainTable = localizationHelper.getDateStartOfDay(mainTableDateHeaders[mainTableDateHeaders.length - 1].id);

    // get all date values from row, keep only until last day in the table
    // rest split among additional tables
    for (let prop in partialRecord) {
      if (
        partialRecord.hasOwnProperty(prop) &&
        partialRecord[prop] !== null &&
        partialRecord[prop] !== undefined &&
        partialRecord[prop].isDate
      ) {
        let parsedDate = localizationHelper.getDateStartOfDay(prop);
        if (parsedDate.isAfter(lastDayInMainTable)) {
          // find the suitable additional table
          let suitableAdditionalTable = additionalTables.filter((tableDef) => {
            if (tableDef.headers.length) {
              let lastDay = tableDef.headers[tableDef.headers.length - 1].id;
              return parsedDate.isSameOrBefore(localizationHelper.getDateStartOfDay(lastDay));
            }
            return false;
          });
          if (suitableAdditionalTable.length) {
            suitableAdditionalTable[0].values[0] = suitableAdditionalTable[0].values[0] || {};
            suitableAdditionalTable[0].values[0][prop] = partialRecord[prop].value;
          }
          delete partialRecord[prop];
        } else {
          partialRecord[prop] = partialRecord[prop].value;
        }
      }
    }
  }

  // table data contains one row
  // because we build one table per contact
  const tableData = [partialRecord];

  return {
    main: {
      headers: headers,
      data: tableData
    },
    additional: additionalTables
  };
};

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
   * @param options
   * @param defaultHeaders
   * @param data
   * @param followUpStatusMap
   */
  sendData(options, defaultHeaders, data, followUpStatusMap) {
    if (options.startDocument) {
      PdfUtils.addTitle(doc, options.startDocument.title);
      doc.moveDown();

      // follow up status legend
      PdfUtils.addTitle(doc, options.startDocument.legend.title, 12);
      for (let statusId in options.startDocument.legend.values) {
        PdfUtils.addTitle(doc, `${statusId} = ${options.startDocument.legend.values[statusId]}`, 8);
      }

      // set margin top for first page here, to not change the entire createPdfDoc functionality
      doc.moveDown(2);
    } else {
      // add a new page for each group
      doc.addPage();
    }

    // add group title
    PdfUtils.addTitle(doc, `${options.groupTitle}: ${data.name}`, 14);
    doc.moveDown();

    // hold the initial X value, used to reset tables
    const resetX = doc.x;

    const asyncFunctions = data.records.map((contact) => {
      return function (cb) {
        setImmediate(() => {
          // build table for the contact
          const tables = buildTableForContact(defaultHeaders.slice(), contact, followUpStatusMap);

          // add tables
          PdfUtils.createTableInPDFDocument(tables.main.headers, tables.main.data, doc, null, true);
          doc.x = resetX;

          tables.additional.forEach((tableDef) => {
            PdfUtils.createTableInPDFDocument(tableDef.headers, tableDef.values, doc, null, true);
            doc.x = resetX;
          });
          doc.x = resetX;

          doc.moveDown();
          cb();
        });
      };
    });

    // run the table creation async
    Async.parallelLimit(asyncFunctions, 100, function () {
      // add total records information
      doc.moveDown();
      PdfUtils.addTitle(doc, `${options.totalTitle}: ${data.records.length}`, 12);

      // after finishing adding data to the doc, inform client that the worker is ready for the next batch
      process.send([null, {readyForNextBatch: true}]);
    });
  },
  /**
   * Inform the worker that there is no more data to be added
   */
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
