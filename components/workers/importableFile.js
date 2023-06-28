'use strict';

const importableFile = require('./../importableFile');
const stream = require('stream');
const util = require('util');
const pipeline = util.promisify(stream.pipeline);
const fs = require('fs');
const path = require('path');
const os = require('os');
const jsonStream = require('JSONStream');
const es = require('event-stream');

/**
 * Send message to parent
 * @param message
 */
const sendMessageToParent = function (message) {
  process.send([null, message]);
};

/**
 * Send error message to parent
 * @param error
 */
const sendErrorToParent = function (error) {
  process.send([error instanceof Error ? {
    message: error.message,
    stack: error.stack
  } : error]);
};

const worker = {
  /**
   * Upload an importable file
   */
  upload: importableFile.upload,
  /**
   * Get distinct values for headers
   */
  getDistinctValuesForHeaders: importableFile.getDistinctValuesForHeaders,
  /**
   * Read and format data from importable file
   * Runs as a worker with communication
   */
  readAndFormatDataFromImportableFile: function (options) {
    // initialize map for data formatters container
    const dataTypeToFormatterMap = {
      case: './../baseModelOptions/case',
      event: './../baseModelOptions/event',
      contact: './../baseModelOptions/contact',
      labResult: './../baseModelOptions/labResult',
      contactOfContact: './../baseModelOptions/contactOfContact',
      relationship: './../baseModelOptions/relationship',
      referenceData: './../baseModelOptions/referenceData',
      location: './../baseModelOptions/location',
      user: './../baseModelOptions/user',
      role: './../baseModelOptions/role',
      team: './../baseModelOptions/team'
    };

    if (!dataTypeToFormatterMap[options.dataType]) {
      sendErrorToParent(new Error(`Worker received an invalid data type "${options.dataType}" that cannot handle.`));
      return;
    }

    // get data processor
    let dataFormatter, getAdditionalFormatOptions;
    try {
      const dataTypeHelpers = require(dataTypeToFormatterMap[options.dataType]).helpers;
      dataFormatter = dataTypeHelpers.formatItemFromImportableFile;
      getAdditionalFormatOptions = dataTypeHelpers.getAdditionalFormatOptions;
      if (typeof dataFormatter !== 'function') {
        throw 'Processing function is not defined';
      }
    } catch (err) {
      sendErrorToParent(new Error(`Worker received data type "${options.dataType}" processer was not found. Err: ${err}`));
      return;
    }

    // initialize cache for processed data
    const dataToSend = [];

    // cache batch size; number of items to send to parent process
    const batchSize = options.batchSize;

    // allow formatter to parse a maximum of 2x batch size to not have the parent process wait for parsed items
    const formatterBatchSize = batchSize * 2;

    // initialize variable to know when all data has been processed
    let allDataProcessed = false;

    // initialize calculate stream
    let cstream;
    const calculateStream = es.through(function (item) {
      cstream = this;
      // process data
      dataFormatter(item, dataToSend, options);

      if (dataToSend.length >= formatterBatchSize) {
        // we reached batch size; pause until the batch is sent to parent process
        cstream.pause();
      }
    });

    // get importable file metadata
    importableFile
      .getTemporaryFileById(`${options.fileId}${importableFile.metadataFileSuffix}`)
      .then(fileMetadata => {
        // send message to parent to know that processing has started
        sendMessageToParent({
          subject: 'start',
          // send total number of items to import
          totalNo: fileMetadata.totalNoItems
        });

        // get additional format options if available
        getAdditionalFormatOptions && getAdditionalFormatOptions(options);

        // read dataset file
        const readStream = fs.createReadStream(path.join(os.tmpdir(), options.fileId));

        // run pipeline which will read contents and make required calculations on each data
        return pipeline(
          readStream,
          jsonStream.parse('*'),
          calculateStream
        );
      })
      .then(() => {
        allDataProcessed = true;
        sendMessageToParent({
          subject: 'log',
          log: 'All data was formatted'
        });
      })
      .catch(sendErrorToParent);

    // handle messages from parent process
    process.on('message', function (message) {
      // depending on message we need to make different actions
      switch (message.subject) {
        case 'nextBatch': {
          // resume dataset calculations if paused
          if (cstream && cstream.paused) {
            cstream.resume();
          }

          sendMessageToParent({
            subject: 'nextBatch',
            // send data for this batch; max batchSize items will be send
            data: dataToSend.splice(0, batchSize)
          });

          if (allDataProcessed && !dataToSend.length) {
            sendMessageToParent({
              subject: 'finished'
            });
          }

          break;
        }
        default:
          // unhandled subject
          sendErrorToParent(new Error(`Worker received an invalid message subject '${message.subject}'`));
          break;
      }
    });
  }
};

process.on('message', function (message) {
  // handle only message that contains fn in order to execute needed function
  if (message.fn) {
    if (!message.communication) {
      // normal worker
      worker[message.fn](...message.args)
        .then(function (result) {
          process.send([null, result]);
        })
        .catch(function (error) {
          process.send([error instanceof Error ? {
            message: error.message,
            stack: error.stack
          } : error]);
        });
    } else {
      // communication worker
      worker[message.fn](message.options);
    }
  }
});

