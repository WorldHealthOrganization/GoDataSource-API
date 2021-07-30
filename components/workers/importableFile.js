'use strict';

const importableFile = require('./../importableFile');

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
      labResult: './../baseModelOptions/labResult'
    };

    if (!dataTypeToFormatterMap[options.dataType]) {
      sendErrorToParent(new Error(`Worker received an invalid data type "${options.dataType}" that cannot handle.`));
      return;
    }

    // get data processor
    let dataFormatter;
    try {
      dataFormatter = require(dataTypeToFormatterMap[options.dataType]).helpers.formatDataFromImportableFile;
      if (typeof dataFormatter !== 'function') {
        throw 'Processing function is not defined';
      }
    } catch (err) {
      sendErrorToParent(new Error(`Worker received data type "${options.dataType}" processer was not found. Err: ${err}`));
      return;
    }

    // initialize cache for processed data
    const dataToSend = [];

    // cache batch size
    const batchSize = options.batchSize;

    // initialize variable to know when all data has been processed
    let allDataProcessed = false;

    // get importable file
    importableFile
      .getTemporaryFileById(options.fileId)
      .then(file => {
        // get file content
        const rawData = file.data;

        // send message to parent to know that processing has started
        sendMessageToParent({
          subject: 'start',
          // send total number of items to import
          totalNo: rawData.length
        });

        // process data
        return dataFormatter(rawData, dataToSend, options);
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

