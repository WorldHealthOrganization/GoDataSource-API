const excel = require('exceljs');
const uuid = require('uuid');
const tmp = require('tmp');
const path = require('path');
const csvStringify = require('csv-stringify');
const _ = require('lodash');
const fs = require('fs');
const moment = require('moment');
const config = require('../server/config');
const MongoDBHelper = require('./mongoDBHelper');
const mergeFilters = require('./mergeFilters');
const genericHelpers = require('./helpers');
const aesCrypto = require('./aesCrypto');
const archiver = require('archiver');
const xlsx = require('xlsx');

// default language - in case we don't have user language
// - or if user language token translations are missing then they are replaced by default language tokens which should have all tokens...
const DEFAULT_LANGUAGE = 'english_us';

// temporary database prefix
const TEMPORARY_DATABASE_PREFIX = 'zExport_';

// string used to anonymize values
const ANONYMIZE_VALUE = '***';

// flat specific properties
// - used to determine max number of columns for questionnaire values (kinda try to make column unique, to not conflict with model properties)
const FLAT_MAX_ANSWERS_PREFIX = '_';
// - used to determine max number of columns for questionnaire with multiple answer dropdowns
const FLAT_MULTIPLE_ANSWER_SUFFIX = '_multiple';

// FLAT / NON FLAT TYPES
const EXPORT_TYPE = {
  JSON: 'json',
  XML: 'xml',
  XLSX: 'xlsx',
  CSV: 'csv',
  XLS: 'xls'
};
const NON_FLAT_TYPES = [
  EXPORT_TYPE.JSON,
  EXPORT_TYPE.XML
];

// default export type - in case export type isn't provided
const DEFAULT_EXPORT_TYPE = EXPORT_TYPE.JSON;

// spreadsheet limits
const SHEET_LIMITS = {
  XLSX: {
    MAX_COLUMNS: config && config.export && config.export.xlsx && config.export.xlsx.maxColumnsPerSheet ?
      config.export.xlsx.maxColumnsPerSheet :
      16000,
    MAX_ROWS: config && config.export && config.export.xlsx && config.export.xlsx.maxRowsPerFile ?
      config.export.xlsx.maxRowsPerFile :
      1000000
  },
  XLS: {
    MAX_COLUMNS: config && config.export && config.export.xls && config.export.xls.maxColumnsPerSheet ?
      config.export.xls.maxColumnsPerSheet :
      250,
    MAX_ROWS: config && config.export && config.export.xls && config.export.xls.maxRowsPerFile ?
      config.export.xls.maxRowsPerFile :
      30000
  }
};

/**
 * Export filtered model list
 * @param parentCallback Used to send data to parent (export log id / errors)
 * @param modelOptions Options for the model that will be exported
 * @param filter
 * @param exportType
 * @param encryptPassword {string|null}
 * @param anonymizeFields
 * @param fieldsGroupList
 * @param options
 */
function exportFilteredModelsList(
  parentCallback,
  modelOptions,
  filter,
  exportType,
  encryptPassword,
  anonymizeFields,
  fieldsGroupList,
  options
) {
  try {
    // prepare query filters
    const initializeQueryFilters = () => {
      // filter
      let dataFilter = filter ?
        _.cloneDeep(filter) :
        {};

      // check for additional scope query that needs to be added
      if (modelOptions.scopeQuery) {
        dataFilter = mergeFilters(
          modelOptions.scopeQuery,
          dataFilter
        );
      }

      // check for deleted flag; by default all items will be retrieved including deleted
      if (!dataFilter.deleted) {
        dataFilter = mergeFilters(dataFilter, {
          where: {
            deleted: false
          }
        });
      }

      // convert loopback query to mongodb query
      dataFilter = MongoDBHelper.getMongoDBOptionsFromLoopbackFilter(dataFilter);

      // finished
      return dataFilter;
    };

    // initialize column headers
    const initializeColumnHeaders = () => {
      // get fields that need to be exported from model options
      let fieldLabelsMap = modelOptions.sanitizeFieldLabelsMapForExport ?
        modelOptions.sanitizeFieldLabelsMapForExport() :
        Object.assign(
          {},
          modelOptions.fieldLabelsMap
        );

      // filter field labels list if fields groups were provided
      let modelExportFieldsOrder = modelOptions.exportFieldsOrder;
      if (
        fieldsGroupList &&
        fieldsGroupList.length > 0 &&
        modelOptions.exportFieldsGroup
      ) {
        // get all properties from each fields group
        const exportFieldLabelsMap = {};
        Object.keys(modelOptions.exportFieldsGroup).forEach((groupName) => {
          if (fieldsGroupList.includes(groupName)) {
            if (
              modelOptions.exportFieldsGroup[groupName].properties &&
              modelOptions.exportFieldsGroup[groupName].properties.length
            ) {
              modelOptions.exportFieldsGroup[groupName].properties.forEach((propertyName) => {
                // add property and token
                if (fieldLabelsMap[propertyName]) {
                  exportFieldLabelsMap[propertyName] = fieldLabelsMap[propertyName];
                }
              });
            }
          }
        });

        // use the headers come from export
        if (!_.isEmpty(exportFieldLabelsMap)) {
          // update the new list of exported fields
          fieldLabelsMap = exportFieldLabelsMap;

          // ignore export fields order
          modelExportFieldsOrder = undefined;
        }
      }

      // some models may have a specific order for headers
      let fieldsList = [];
      const fieldLabelsKeys = Object.keys(fieldLabelsMap);
      if (!_.isEmpty(modelExportFieldsOrder)) {
        // start with items from our order
        fieldsList = modelExportFieldsOrder;
        const alreadyIncludedFields = _.invert(modelExportFieldsOrder);

        // add the rest of the fields
        fieldLabelsKeys.forEach((field) => {
          // already include ?
          if (alreadyIncludedFields[field] !== undefined) {
            return;
          }

          // add it to the list
          fieldsList.push(field);
        });
      } else {
        fieldsList = fieldLabelsKeys;
      }

      // replace id with _id since were using mongo without loopback
      const idIndex = fieldsList.indexOf('id');
      if (idIndex > -1) {
        fieldsList.splice(
          idIndex,
          1,
          '_id'
        );
      }
      if (fieldLabelsMap.id) {
        fieldLabelsMap._id = fieldLabelsMap.id;
        delete fieldLabelsMap.id;
      }

      // finished
      return {
        headerKeys: fieldsList,
        headerColumns: [],
        arrayColumnMaxValues: {},
        labels: fieldLabelsMap,

        // location fields
        includeParentLocationData: fieldsGroupList && fieldsGroupList.length > 0 && modelOptions.exportFieldsGroup ?
          fieldsGroupList.includes('LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA') :
          true,
        locationsFieldsMap: !modelOptions.locationFields || modelOptions.locationFields.length < 1 ?
          {} :
          modelOptions.locationFields.reduce(
            (acc, property) => {
              // attach prop
              acc[property] = true;

              // continue
              return acc;
            },
            {}
          ),

        // anonymize fields
        anonymizeString: ANONYMIZE_VALUE,
        anonymizeMap: anonymizeFields && anonymizeFields.length > 0 ?
          anonymizeFields.reduce(
            (acc, property) => {
              // attach prop
              acc[property.toLowerCase()] = true;

              // continue
              return acc;
            },
            {}
          ) : {},
        shouldAnonymize: (path) => {
          const levels = (path || '').toLowerCase().replace(/\[\]/g, '').split('.');
          let pathSoFar = '';
          for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
            // shouldn't have empty values...but
            if (!levels[levelIndex]) {
              continue;
            }

            // check if this is anonymize
            pathSoFar = `${pathSoFar ? pathSoFar + '.' : ''}${levels[levelIndex]}`;
            if (sheetHandler.columns.anonymizeMap[pathSoFar]) {
              return true;
            }
          }
        }
      };
    };

    // prefix name so we don't encounter duplicates
    const getQuestionnaireQuestionUniqueKey = (key) => {
      return `${FLAT_MAX_ANSWERS_PREFIX}${key}`;
    };

    // prefix name so we don't encounter duplicates for multiple dropdown
    const getQuestionnaireQuestionUniqueKeyForMultipleAnswers = (key) => {
      return `${getQuestionnaireQuestionUniqueKey(key)}${FLAT_MULTIPLE_ANSWER_SUFFIX}`;
    };

    // prepare questionnaire data
    const prepareQuestionnaireData = () => {
      // go through questionnaire questions and map them accordingly
      const response = {
        flat: [],
        nonFlat: []
      };
      if (
        options.questionnaire &&
        options.questionnaire.length > 0
      ) {
        // what is important to keep from a question
        const addQuestionData = (
          flatArray,
          nonFlatArray,
          question
        ) => {
          // some types are ignored since there is no point in exporting them ?
          if (
            !question.text ||
            !question.text.startsWith('LNG_') ||
            !question.variable ||
            question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP'
          ) {
            return;
          }

          // init question
          const formattedQuestion = {
            variable: question.variable,
            text: question.text,
            answerType: question.answerType,
            childQuestions: [],
            answerKeyToLabelMap: {}
          };

          // attach question to flat array
          flatArray.push(formattedQuestion);

          // add to non flat array if we have one
          if (nonFlatArray) {
            nonFlatArray.push(formattedQuestion);
          }

          // attach child question recursively so they keep the order of display
          if (
            question.answers &&
            question.answers.length > 0
          ) {
            question.answers.forEach((answer) => {
              // attach answers labels
              formattedQuestion.answerKeyToLabelMap[answer.value] = answer.label;

              // attach child questions if we have any
              if (
                answer &&
                answer.additionalQuestions &&
                answer.additionalQuestions.length > 0
              ) {
                answer.additionalQuestions.forEach((childQuestion) => {
                  addQuestionData(
                    flatArray,
                    formattedQuestion.childQuestions,
                    childQuestion
                  );
                });
              }
            });
          }
        };

        // format questionnaire
        options.questionnaire.forEach((questionData) => {
          // attach our question and it children question one after another
          addQuestionData(
            response.flat,
            response.nonFlat,
            questionData
          );
        });
      }

      // finished
      return response;
    };

    // prepare temporary workbook
    const initializeTemporaryWorkbook = () => {
      // format export type
      exportType = exportType || DEFAULT_EXPORT_TYPE;
      exportType = exportType.toLowerCase();

      // create stream workbook so we can write in it when we have data
      const exportLogId = uuid.v4();
      const filePath = path.resolve(tmp.tmpdir, `${exportLogId}.${exportType}`);

      // initialize workbook file - XLSX
      let xlsxWorkbook, xlsxWorksheets;
      const initializeXlsx = () => {
        // workbook
        xlsxWorkbook = new excel.stream.xlsx.WorkbookWriter({
          filename: filePath
        });
      };

      // initialize workbook file - XLS
      let xlsDataBuffer, xlsColumnsPerSheet;
      const initializeXls = () => {
        xlsDataBuffer = [];
      };

      // initialize object needed by each type
      const exportIsNonFlat = NON_FLAT_TYPES.includes(exportType);
      let csvWriteStream, jsonWriteStream, jsonWroteFirstRow;
      let mimeType;
      switch (exportType) {
        case EXPORT_TYPE.XLSX:
          // set mime type
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

          // initialize workbook file
          initializeXlsx();

          // finished
          break;

        case EXPORT_TYPE.XLS:
          // set mime type
          mimeType = 'application/vnd.ms-excel';

          // initialize workbook file
          initializeXls();

          // finished
          break;

        case EXPORT_TYPE.CSV:
          // set mime type
          mimeType = 'text/csv';

          // initialize write stream
          csvWriteStream = fs.createWriteStream(
            filePath, {
              encoding: 'utf8'
            }
          );

          // handle errors
          // - for now just throw them further
          csvWriteStream.on('error', (err) => {
            throw err;
          });

          // finished
          break;

        case EXPORT_TYPE.JSON:
          // set mime type
          mimeType = 'application/json';

          // initialize write stream
          jsonWriteStream = fs.createWriteStream(
            filePath, {
              encoding: 'utf8'
            }
          );

          // write array starter
          jsonWriteStream.write('[');

          // handle errors
          // - for now just throw them further
          jsonWriteStream.on('error', (err) => {
            throw err;
          });

          // finished
          break;

        // not supported
        default:
          throw new Error('Export type not supported');
      }

      // set columns depending of export type
      const setColumns = () => {
        switch (exportType) {
          case EXPORT_TYPE.XLSX:
            // initialize worksheets accordingly to max number of columns per worksheet
            xlsxWorksheets = [];
            const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.XLSX.MAX_COLUMNS) + 1;
            for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
              // create sheet
              const sheet = xlsxWorkbook.addWorksheet(`Data ${sheetIndex + 1}`);

              // set columns per sheet
              const startColumnsPos = sheetIndex * SHEET_LIMITS.XLSX.MAX_COLUMNS;
              sheet.columns = sheetHandler.columns.headerColumns.slice(
                startColumnsPos,
                startColumnsPos + SHEET_LIMITS.XLSX.MAX_COLUMNS
              );

              // add it to the list
              xlsxWorksheets.push(sheet);
            }

            // finished
            break;

          case EXPORT_TYPE.XLS:

            // no need to split ?
            if (sheetHandler.columns.headerColumns.length < SHEET_LIMITS.XLS.MAX_COLUMNS) {
              xlsColumnsPerSheet = [
                sheetHandler.columns.headerColumns.map((column) => column.header)
              ];
            } else {
              // must split columns
              xlsColumnsPerSheet = [];
              const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.XLS.MAX_COLUMNS) + 1;
              for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
                // determine columns for this sheet
                const startColumnsPos = sheetIndex * SHEET_LIMITS.XLS.MAX_COLUMNS;
                const columns = sheetHandler.columns.headerColumns.slice(
                  startColumnsPos,
                  startColumnsPos + SHEET_LIMITS.XLS.MAX_COLUMNS
                ).map((column) => column.header);

                // attach sheet with columns
                if (
                  columns &&
                  columns.length > 0
                ) {
                  xlsColumnsPerSheet.push(columns);
                }
              }
            }

            // finished
            break;

          case EXPORT_TYPE.CSV:
            // set columns
            const columns = sheetHandler.columns.headerColumns.map((column) => column.header);
            csvStringify(
              [], {
                header: true,
                columns
              },
              (err, csvData) => {
                // did we encounter an error ?
                if (err) {
                  throw err;
                }

                // write data
                csvWriteStream.write(csvData);
              }
            );

            // finished
            break;

          case EXPORT_TYPE.JSON:
            // for json we don't need to write column definitions
            // nothing

            // finished
            break;

          // not supported
          default:
            throw new Error('Export type not supported');
        }
      };

      // add row depending of export type
      // - returns a promise: wait for data to be written
      let addRowCounted = 0;
      const addRow = (data) => {
        return new Promise((resolve, reject) => {
          switch (exportType) {
            case EXPORT_TYPE.XLSX:
              // add row
              const actualAddRow = () => {
                // - must split into sheets if there are more columns than we are allowed to export per sheet ?
                if (sheetHandler.columns.headerColumns.length <= SHEET_LIMITS.XLSX.MAX_COLUMNS) {
                  // does commit wait for stream to flush
                  // - or we might loose data just as we did with jsonWriteStream.write until we waited for write to flush - promise per record ?
                  xlsxWorksheets[0].addRow(data).commit();
                } else {
                  // append data for each sheet
                  const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.XLSX.MAX_COLUMNS) + 1;
                  for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
                    // set data per sheet
                    const startColumnsPos = sheetIndex * SHEET_LIMITS.XLSX.MAX_COLUMNS;

                    // does commit wait for stream to flush
                    // - or we might loose data just as we did with jsonWriteStream.write until we waited for write to flush - promise per record ?
                    xlsxWorksheets[sheetIndex].addRow(data.slice(
                      startColumnsPos,
                      startColumnsPos + SHEET_LIMITS.XLSX.MAX_COLUMNS
                    )).commit();
                  }
                }
              };

              // reached the limit of rows per file ?
              addRowCounted++;
              if (addRowCounted >= SHEET_LIMITS.XLSX.MAX_ROWS) {
                // reset row count
                addRowCounted = 0;

                // close file
                sheetHandler.process
                  .finalize()
                  .then(() => {
                    // rename file
                    fs.renameSync(
                      sheetHandler.filePath,
                      `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
                    );

                    // create new workbook
                    sheetHandler.process.fileNo++;

                    // initialize workbook file
                    initializeXlsx();

                    // set columns for the new file
                    setColumns();

                    // write row
                    actualAddRow();

                    // finished
                    resolve();
                  })
                  .catch(reject);
              } else {
                // write row
                actualAddRow();

                // finished
                resolve();
              }

              // finished
              break;

            case EXPORT_TYPE.XLS:
              // append row
              xlsDataBuffer.push(data);

              // reached the limit of rows per file ?
              if (xlsDataBuffer.length >= SHEET_LIMITS.XLS.MAX_ROWS) {
                // close file
                sheetHandler.process
                  .finalize()
                  .then(() => {
                    // rename file
                    fs.renameSync(
                      sheetHandler.filePath,
                      `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
                    );

                    // create new workbook
                    sheetHandler.process.fileNo++;

                    // initialize workbook file
                    initializeXls();

                    // set columns for the new file
                    // - not really necessary to again, but for consistency sake..and since it not much of a fuss
                    setColumns();

                    // finished
                    resolve();
                  })
                  .catch(reject);
              } else {
                // finished
                resolve();
              }

              // finished
              break;

            case EXPORT_TYPE.CSV:
              // add row
              csvStringify(
                [data],
                (err, csvData) => {
                  // did we encounter an error ?
                  if (err) {
                    return reject(err);
                  }

                  // write data
                  csvWriteStream.write(
                    csvData,
                    (err) => {
                      // error occurred ?
                      if (err) {
                        return reject(err);
                      }

                      // flushed
                      resolve();
                    }
                  );
                }
              );

              // finished
              break;

            case EXPORT_TYPE.JSON:
              // divider
              if (jsonWroteFirstRow) {
                jsonWriteStream.write(',');
              }

              // append row
              jsonWriteStream.write(
                JSON.stringify(data),
                (err) => {
                  // error occurred ?
                  if (err) {
                    return reject(err);
                  }

                  // flushed
                  resolve();
                }
              );

              // first row was written
              jsonWroteFirstRow = true;

              // finished
              break;

            // not supported
            default:
              throw new Error('Export type not supported');
          }
        });
      };

      // close stream depending of export type
      // - must return promise
      const finalize = () => {
        // update number of records
        return sheetHandler
          .updateExportLog({
            processedNo: sheetHandler.processedNo,
            updatedAt: new Date()
          })
          .then(() => {
            switch (exportType) {
              case EXPORT_TYPE.XLSX:
                // finalize
                return xlsxWorkbook.commit();

              case EXPORT_TYPE.XLS:
                // create workbook for current bulk of data
                const currentWorkBook = xlsx.utils.book_new();

                // create sheets
                for (let sheetIndex = 0; sheetIndex < xlsColumnsPerSheet.length; sheetIndex++) {
                  // get columns
                  const sheetColumns = xlsColumnsPerSheet[sheetIndex];

                  // single sheet ?
                  let rows;
                  if (xlsColumnsPerSheet.length < 2) {
                    rows = [
                      sheetColumns,
                      ...xlsDataBuffer
                    ];
                  } else {
                    // multiple sheets, must split data
                    // - append headers
                    rows = [
                      sheetColumns
                    ];

                    // go through rows and retrieve only our columns data
                    const startColumnsPos = sheetIndex * SHEET_LIMITS.XLS.MAX_COLUMNS;
                    for (let rowIndex = 0; rowIndex < xlsDataBuffer.length; rowIndex++) {
                      // get record data
                      const rowData = xlsDataBuffer[rowIndex];
                      rows.push(
                        rowData.slice(
                          startColumnsPos,
                          startColumnsPos + SHEET_LIMITS.XLS.MAX_COLUMNS
                        )
                      );
                    }
                  }

                  // write sheet
                  xlsx.utils.book_append_sheet(
                    currentWorkBook,
                    xlsx.utils.aoa_to_sheet(rows),
                    `Data ${sheetIndex + 1}`
                  );
                }

                // write file
                xlsx.writeFile(
                  currentWorkBook,
                  sheetHandler.filePath, {
                    type: 'buffer',
                    bookType: 'biff8'
                  }
                );

                // finished
                return Promise.resolve();

              case EXPORT_TYPE.CSV:
                // finalize
                csvWriteStream.close();
                return Promise.resolve();

              case EXPORT_TYPE.JSON:
                // write json end
                jsonWriteStream.write(']');

                // finalize
                jsonWriteStream.close();
                return Promise.resolve();

              // not supported
              default:
                throw new Error('Export type not supported');
            }
          });
      };

      // finished
      const columns = initializeColumnHeaders();
      return {
        languageId: options.contextUserLanguageId || DEFAULT_LANGUAGE,
        exportLogId,
        temporaryCollectionName: `${TEMPORARY_DATABASE_PREFIX}${exportLogId}`,
        temporaryDistinctLocationsKey: 'allUsedLocationIds',
        processedNo: 0,
        batchSize: config.export && config.export.batchSize > 0 ?
          config.export.batchSize :
          5000,
        locationFindBatchSize: config.export && config.export.locationFindBatchSize > 0 ?
          config.export.locationFindBatchSize :
          1000,
        saveFilter: config && config.export && !!config.export.saveFilter,
        saveAggregateFilter: config && config.export && !!config.export.saveAggregateFilter,
        filePath,
        mimeType,
        columns,

        // process
        process: {
          fileNo: 1,
          exportIsNonFlat,
          setColumns,
          addRow,
          finalize
        },

        // questionnaire
        questionnaireQuestionsData: prepareQuestionnaireData(),
        questionnaireUseVariablesAsHeaders: !!options.useQuestionVariable,

        // no need for header translations ?
        useDbColumns: !!options.useDbColumns,
        dontTranslateValues: !!options.dontTranslateValues,

        // dictionary
        dictionaryMap: {},

        // locations
        locationsMaxNumberOfIdentifiers: 0,
        locationsMaxSizeOfParentsChain: 0,
        locationsMap: {},

        // retrieve only the fields that we need
        projection: columns.headerKeys.reduce(
          (acc, property) => {
            // attach prop
            acc[property] = 1;

            // continue
            return acc;
          },
          {}
        ),

        // update export log
        updateExportLog: (dataToUpdate) => {
          // prepare data
          return exportLog
            .updateOne({
              _id: sheetHandler.exportLogId
            }, {
              '$set': dataToUpdate
            });
        }
      };
    };

    // used collection
    let exportLog, temporaryCollection, languageToken, location;

    // defaultLanguage must be initialized before initializeTemporaryWorkbook
    const defaultQuestionnaireAnswersKey = 'questionnaireAnswers';
    const dataFilter = initializeQueryFilters();
    const sheetHandler = initializeTemporaryWorkbook();

    // drop collection
    const dropTemporaryCollection = () => {
      // temporary collection was initialized ?
      if (temporaryCollection) {
        return temporaryCollection
          .drop()
          .then(() => {
            temporaryCollection = undefined;
          });
      }

      // no temporary collection ?
      return Promise.resolve();
    };

    // delete secondary temporary files
    const deleteSecondaryFiles = (basePath) => {
      // check if there are further files to delete
      for (let fileIndex = 1; fileIndex <= sheetHandler.process.fileNo; fileIndex++) {
        const secondaryFile = `${basePath}_${fileIndex}`;
        if (fs.existsSync(secondaryFile)) {
          try {
            fs.unlinkSync(secondaryFile);
          } catch (e) {
            // NOTHING
          }
        }
      }
    };

    // delete file
    const deleteTemporaryFile = () => {
      return Promise.resolve()
        .then(() => {
          // temporary file was initialized ?
          if (
            sheetHandler &&
            sheetHandler.filePath
          ) {
            // main file
            if (fs.existsSync(sheetHandler.filePath)) {
              try {
                fs.unlinkSync(sheetHandler.filePath);
              } catch (e) {
                // NOTHING
              }
            }

            // check if there are further files to delete
            deleteSecondaryFiles(sheetHandler.filePath);

            // reset
            sheetHandler.filePath = null;
          }
        });
    };

    // encrypt exported file
    const encryptFiles = () => {
      // do we need to encrypt ?
      if (!encryptPassword) {
        return Promise.resolve();
      }

      // encrypt
      const encryptFile = (filePath) => {
        // encrypt
        const encryptPath = `${filePath}.encrypt`;
        const dataFileStream = fs.createReadStream(filePath);
        const encryptFileStream = fs.createWriteStream(encryptPath);
        return aesCrypto
          .encryptStream(
            dataFileStream,
            encryptFileStream,
            encryptPassword
          )
          .then(() => {
            // remove data file
            fs.unlinkSync(filePath);

            // replace file with encrypted file
            fs.renameSync(
              encryptPath,
              filePath
            );
          });
      };

      // start encrypting
      return sheetHandler
        .updateExportLog({
          statusStep: 'LNG_STATUS_STEP_ENCRYPT',
          updatedAt: new Date()
        })
        .then(() => {
          // single file to encrypt ?
          if (sheetHandler.process.fileNo < 2) {
            return encryptFile(sheetHandler.filePath);
          }

          // process encryption for next file
          let fileNoToProcess = 0;
          const nextFile = () => {
            // next
            fileNoToProcess++;

            // nothing else to process ?
            // last one in this case is handled above / bellow (encryptFile(sheetHandler.filePath).then)
            if (fileNoToProcess >= sheetHandler.process.fileNo) {
              return Promise.resolve();
            }

            // encrypt
            return encryptFile(`${sheetHandler.filePath}_${fileNoToProcess}`)
              .then(nextFile);
          };

          // go through each file & encrypt
          return encryptFile(sheetHandler.filePath)
            .then(nextFile);
        });
    };

    // zip multiple files
    const zipIfMultipleFiles = () => {
      // single file ?
      if (sheetHandler.process.fileNo < 2) {
        return Promise.resolve();
      }

      // multiple files
      try {
        // rename main file to match the rest
        // - main file is actually the last one in the order of files
        fs.renameSync(
          sheetHandler.filePath,
          `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
        );

        // update file path to zip
        const zipExtension = 'zip';
        const oldFilePath = sheetHandler.filePath;
        sheetHandler.filePath = path.resolve(tmp.tmpdir, `${sheetHandler.exportLogId}.${zipExtension}`);

        // start archiving
        return sheetHandler
          .updateExportLog({
            statusStep: 'LNG_STATUS_STEP_ARCHIVE',
            extension: zipExtension,
            mimeType: 'application/zip',
            updatedAt: new Date()
          })
          .then(() => {
            // handle archive async
            return new Promise((resolve, reject) => {
              try {
                // initialize output
                const output = fs.createWriteStream(sheetHandler.filePath);

                // initialize archived
                const archive = archiver('zip');

                // listen for all archive data to be written
                // 'close' event is fired only when a file descriptor is involved
                output.on('close', function () {
                  // cleanup
                  // - remove files that were archived
                  deleteSecondaryFiles(oldFilePath);

                  // finished
                  resolve();
                });

                // archiving errors
                archive.on('error', function (err) {
                  reject(err);
                });

                // pipe archive data to the output file
                archive.pipe(output);

                // append files
                for (let fileIndex = 1; fileIndex <= sheetHandler.process.fileNo; fileIndex++) {
                  archive.file(
                    `${oldFilePath}_${fileIndex}`, {
                      name: `${fileIndex}.${exportType}`
                    }
                  );
                }

                // wait for streams to complete
                archive.finalize();
              } catch (err) {
                reject(err);
              }
            });
          });
      } catch (err) {
        return Promise.reject(err);
      }
    };

    // retrieve mongo db connection - since this export will always run in a worker
    MongoDBHelper
      .getMongoDBConnection()
      .then((dbConn) => {
        // used collections
        const exportDataCollection = dbConn.collection(modelOptions.collectionName);
        exportLog = dbConn.collection('databaseActionLog');
        languageToken = dbConn.collection('languageToken');
        location = dbConn.collection('location');

        // initialize export log
        const initializeExportLog = () => {
          return exportLog
            .insertOne({
              _id: sheetHandler.exportLogId,
              type: 'export-data',
              actionStartDate: new Date(),
              status: 'LNG_SYNC_STATUS_IN_PROGRESS',
              statusStep: 'LNG_STATUS_STEP_RETRIEVING_LANGUAGE_TOKENS',
              resourceType: modelOptions.modelName,
              totalNo: 0,
              processedNo: 0,
              outbreakIDs: [options.outbreakId],
              deleted: false,
              createdAt: new Date(),
              createdBy: options.userId,
              updatedAt: new Date(),
              updatedBy: options.userId,
              mimeType: sheetHandler.mimeType,
              extension: exportType,
              filter: sheetHandler.saveFilter ?
                JSON.stringify(dataFilter) :
                null
            })
            .then(() => {
              // send id to parent and proceed with doing the export
              parentCallback(null, {
                subject: 'WAIT',
                response: sheetHandler.exportLogId
              });
            });
        };

        // retrieve missing tokens
        const retrieveMissingTokens = (languageId, tokenIds) => {
          // default token projection
          const languageTokenProjection = {
            token: 1,
            translation: 1
          };

          // retrieve tokens
          // - preferably in user language but if not found in default language (english_us)
          return languageToken
            .find({
              languageId: languageId,
              token: {
                $in: tokenIds
              }
            }, {
              projection: languageTokenProjection
            })
            .toArray()
            .then((tokens) => {
              // map tokens
              // for faster then forEach :) - monumental gain :)
              for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
                // get record data
                const record = tokens[tokenIndex];
                sheetHandler.dictionaryMap[record.token] = record.translation;
              }

              // if records not found in current language try english
              if (
                languageId !== DEFAULT_LANGUAGE &&
                tokenIds.length !== tokens.length
              ) {
                // find tokens that are missing
                const missingTokenIds = [];
                for (let missingTokenIndex = 0; missingTokenIndex < tokenIds.length; missingTokenIndex++) {
                  // check if we have this token
                  const token = tokenIds[missingTokenIndex];
                  if (sheetHandler.dictionaryMap[token] !== undefined) {
                    // retrieved already
                    continue;
                  }

                  // append to missing tokens
                  missingTokenIds.push(token);
                }

                // retrieve missing tokens
                return retrieveMissingTokens(
                  DEFAULT_LANGUAGE,
                  missingTokenIds
                );
              }
            });
        };

        // initialize language tokens
        const initializeLanguageTokens = () => {
          // retrieve general language tokens
          const languageTokensToRetrieve = sheetHandler.useDbColumns ?
            [] :
            Object.values(sheetHandler.columns.labels);

          // attach general tokens that are always useful to have in your pocket
          // - needed only when not using db columns
          if (!sheetHandler.useDbColumns) {
            languageTokensToRetrieve.push(
              // questionnaire related
              'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE',
              'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'
            );
          }

          // attach general tokens that are always useful to have in your pocket
          languageTokensToRetrieve.push(
            // location related
            'LNG_LOCATION_FIELD_LABEL_ID',
            'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS',
            'LNG_LOCATION_FIELD_LABEL_IDENTIFIER',
            'LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL'
          );

          // attach questionnaire tokens
          if (
            !sheetHandler.useDbColumns &&
            sheetHandler.questionnaireQuestionsData.flat.length > 0
          ) {
            sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
              // question
              languageTokensToRetrieve.push(questionData.text);

              // answers
              _.each(questionData.answerKeyToLabelMap, (labelToken) => {
                languageTokensToRetrieve.push(labelToken);
              });
            });
          }

          // retrieve language tokens
          return retrieveMissingTokens(
            sheetHandler.languageId,
            languageTokensToRetrieve
          );
        };

        // initialize collection view
        const initializeCollectionView = () => {
          // original project
          const project = {
            // force to keep object order by using the collection natural sort when retrieving data
            _id: 0,
            rowId: '$_id'
          };

          // go through location fields so we can construct the retrieval of location ids
          const locationProps = _.isEmpty(sheetHandler.columns.locationsFieldsMap) ?
            [] :
            Object.keys(sheetHandler.columns.locationsFieldsMap);
          const locationContactQuery = {
            $concatArrays: []
          };
          locationProps.forEach((propertyName) => {
            // take action depending if field belong to an array of not
            const propertyArrayIndex = propertyName.indexOf('[]');
            if (propertyArrayIndex > -1) {
              // get array item field name - most of the time should be locationId, but you never know when earth is flat :)
              const arrayField = `$${propertyName.substr(0, propertyArrayIndex)}`;
              const locationItemProp = propertyName.substr(propertyName.lastIndexOf('.') + 1);

              // array merge
              locationContactQuery.$concatArrays.push({
                $cond: {
                  if: {
                    $isArray: arrayField
                  },
                  then: {
                    $map: {
                      input: arrayField,
                      as: 'item',
                      in: `$$item.${locationItemProp}`
                    }
                  },
                  else: []
                }
              });
            } else {
              // not array
              locationContactQuery.$concatArrays.push([
                `$${propertyName}`
              ]);
            }
          });

          // attach location pipe if we have one
          if (locationContactQuery.$concatArrays) {
            project[sheetHandler.temporaryDistinctLocationsKey] = locationContactQuery;
          }

          // we need to retrieve extra information only for flat file types
          if (!sheetHandler.process.exportIsNonFlat) {
            // IMPORTANT!!!
            // IMPORTANT!!!
            // IMPORTANT!!!
            // USING MongoDB 4.4+ would've allowed us to use $function to do all bellow which could've been much faster than having multiple lines of preparations
            // - we might change it after we upgrade from 3.2 to a newer version
            // #TODO

            // determine how many values we have for array properties
            const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
              [] :
              Object.keys(modelOptions.arrayProps);
            arrayProps.forEach((property) => {
              // array field value
              const fieldValue = `$${property}`;

              // attach projection
              project[property] = {
                $cond: {
                  if: {
                    $isArray: fieldValue
                  },
                  then: {
                    $size: fieldValue
                  },
                  else: 0
                }
              };
            });

            // attach questionnaire count to know how many columns we should attach
            if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
              // construct the queries that will be used to determine the number of max columns
              sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
                // attach size answers per date count (multiple answer flag)
                const variableProp = `$${defaultQuestionnaireAnswersKey}.${questionData.variable}`;
                project[getQuestionnaireQuestionUniqueKey(questionData.variable)] = {
                  $cond: {
                    if: {
                      $isArray: variableProp
                    },
                    then: {
                      $size: variableProp
                    },
                    else: 0
                  }
                };

                // attach max multiple answers per question answer (multi select dropdown)
                if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                  const variablePropMultiple = `${variableProp}.value`;
                  project[getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable)] = {
                    $let: {
                      vars: {
                        maxValue: {
                          $max: {
                            $map: {
                              input: {
                                $cond: {
                                  if: {
                                    $isArray: variablePropMultiple
                                  },
                                  then: {
                                    $concatArrays: variablePropMultiple
                                  },
                                  else: []
                                }
                              },
                              as: 'item',
                              in: {
                                $cond: {
                                  if: {
                                    $isArray: '$$item'
                                  },
                                  then: {
                                    $size: '$$item'
                                  },
                                  else: 0
                                }
                              }
                            }
                          }
                        }
                      },
                      in: {
                        $ifNull: ['$$maxValue', 0]
                      }
                    }
                  };
                }
              });
            }
          }

          // aggregate filter
          const aggregateFilter = [
            {
              $match: dataFilter.where
            }, {
              $sort: dataFilter.sort
            }, {
              $project: project
            }, {
              $out: sheetHandler.temporaryCollectionName
            }
          ];

          // update export log in case we need the aggregate filter
          return sheetHandler
            .updateExportLog({
              aggregateFilter: sheetHandler.saveAggregateFilter ?
                JSON.stringify(aggregateFilter) :
                null,
              updatedAt: new Date()
            })
            .then(() => {
              // prepare records that will be exported
              return exportDataCollection
                .aggregate(aggregateFilter, {
                  allowDiskUse: true
                })
                .toArray()
                .then(() => {
                  temporaryCollection = dbConn.collection(sheetHandler.temporaryCollectionName);
                });
            });
        };

        // retrieve missing locations
        const retrieveMissingLocations = (locationIds) => {
          // retrieve locations in batches - just in case
          const locationIdsMap = {};
          return new Promise((resolve, reject) => {
            // batch handler
            const nextBatch = () => {
              // finished ?
              if (
                !locationIds ||
                locationIds.length < 1
              ) {
                return Promise.resolve();
              }

              // next batch to retrieve
              const batchLocationIds = locationIds.splice(
                0,
                sheetHandler.locationFindBatchSize
              );

              // retrieve locations
              return location
                .find({
                  _id: {
                    $in: batchLocationIds
                  }
                }, {
                  projection: {
                    _id: 1,
                    name: 1,
                    identifiers: 1,
                    parentLocationId: 1,
                    geographicalLevelId: 1
                  }
                })
                .toArray()
                .then((locations) => {
                  // map locations
                  for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
                    // get record data
                    const record = locations[locationIndex];
                    sheetHandler.locationsMap[record._id] = record;

                    // initialize parents chain
                    record.parentChain = [];
                    if (sheetHandler.process.exportIsNonFlat) {
                      record.parentChainGeoLvlArray = [];
                    }

                    // identifier map
                    if (sheetHandler.process.exportIsNonFlat) {
                      record.identifiersCodes = record.identifiers && record.identifiers.length > 0 ?
                        record.identifiers.map((identifier) => identifier.code) :
                        [];
                    }

                    // update max number of identifier if necessary
                    sheetHandler.locationsMaxNumberOfIdentifiers = record.identifiers && record.identifiers.length > 0 && record.identifiers.length > sheetHandler.locationsMaxNumberOfIdentifiers ?
                      record.identifiers.length :
                      sheetHandler.locationsMaxNumberOfIdentifiers;
                  }

                  // no need to retrieve parent locations ?
                  if (!sheetHandler.columns.includeParentLocationData) {
                    return;
                  }

                  // retrieve missing parent locations too
                  // - need to loop again because otherwise we might include in missing something that is already retrieved but not added to map
                  for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
                    // get record data
                    const record = locations[locationIndex];

                    // doesn't have parent, no point in continuing
                    if (!record.parentLocationId) {
                      continue;
                    }

                    // parent already retrieved, or will be retrieved ?
                    if (
                      sheetHandler.locationsMap[record.parentLocationId] ||
                      locationIdsMap[record.parentLocationId]
                    ) {
                      continue;
                    }

                    // missing parent
                    locationIdsMap[record.parentLocationId] = true;
                    locationIds.push(record.parentLocationId);
                  }
                })
                .then(nextBatch);
            };

            // retrieve locations
            nextBatch()
              .then(resolve)
              .catch(reject);
          });

        };

        // retrieve locations and determine how many columns we will have - depending of identifiers
        const initializeLocations = () => {
          // retrieve all locations which are used in this export
          // - should we split into bulk? shouldn't be necessary..just for some ids
          return temporaryCollection
            .distinct(sheetHandler.temporaryDistinctLocationsKey)
            .then((locationIds) => {
              // no locations ?
              if (
                !locationIds ||
                locationIds.length < 1 ||
                (locationIds = locationIds.filter((locationId) => locationId)).length < 1
              ) {
                return;
              }

              // retrieve locations
              return retrieveMissingLocations(locationIds);
            })
            .then(() => {
              // determine longest parent location chain
              const locationIds = Object.keys(sheetHandler.locationsMap);
              for (let locationIndex = 0; locationIndex < locationIds.length; locationIndex++) {
                // get location
                const location = sheetHandler.locationsMap[locationIds[locationIndex]];

                // count parents
                let parentLocationId = location.parentLocationId;
                while (parentLocationId) {
                  // attach parent to list
                  location.parentChain.push(parentLocationId);

                  // attach geo levels for easy print
                  if (sheetHandler.process.exportIsNonFlat) {
                    location.parentChainGeoLvlArray.push(
                      sheetHandler.locationsMap[parentLocationId] ?
                        sheetHandler.locationsMap[parentLocationId].geographicalLevelId :
                        '-'
                    );
                  }

                  // retrieve next parent from chain
                  parentLocationId = sheetHandler.locationsMap[parentLocationId] ?
                    sheetHandler.locationsMap[parentLocationId].parentLocationId :
                    undefined;
                }

                // update max chain size if necessary
                sheetHandler.locationsMaxSizeOfParentsChain = location.parentChain.length > sheetHandler.locationsMaxSizeOfParentsChain ?
                  location.parentChain.length :
                  sheetHandler.locationsMaxSizeOfParentsChain;
              }
            });
        };

        // determine header columns
        const initializeColumns = () => {
          // initialize columns
          return Promise.resolve()
            .then(() => {
              // max not needed for non flat file types
              if (sheetHandler.process.exportIsNonFlat) {
                return;
              }

              // determine the maximum number for each array field
              const projectMax = {
                _id: null
              };
              const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
                [] :
                Object.keys(modelOptions.arrayProps);

              // nothing to retrieve ?
              if (arrayProps.length < 1) {
                return;
              }

              // go through array fields and construct query to determine maximum number of records
              arrayProps.forEach((property) => {
                // array field value
                const fieldValue = `$${property}`;

                // attach max projection
                projectMax[property] = {
                  $max: fieldValue
                };
              });

              // determine maximum number of values per questionnaire answers too
              if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
                // construct the queries that will be used to determine the number of max columns
                sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
                  // attach size answers per date count (multiple answer flag)
                  const variableProp = getQuestionnaireQuestionUniqueKey(questionData.variable);
                  projectMax[variableProp] = {
                    $max: `$${variableProp}`
                  };

                  // attach max multiple answers per question answer (multi select dropdown)
                  if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                    const variablePropMultiple = getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable);
                    projectMax[variablePropMultiple] = {
                      $max: `$${variablePropMultiple}`
                    };
                  }
                });
              }

              // determine maximum number of items for each array field
              return temporaryCollection
                .aggregate([{
                  $group: projectMax
                }])
                .toArray();
            })
            .then((maxValues) => {
              // keep a copy of max counts
              sheetHandler.columns.arrayColumnMaxValues = maxValues && maxValues.length > 0 ?
                maxValues[0] :
                {};

              // handle adding columns to make sure they are all unitary
              const addHeaderColumn = (
                header,
                path,
                pathWithoutIndexes,
                uniqueKeyInCaseOfDuplicate,
                formula,
                translate
              ) => {
                // create column
                const columnData = {
                  originalHeader: header,
                  uniqueKeyInCaseOfDuplicate,
                  header,
                  path,
                  pathWithoutIndexes,
                  formula,
                  anonymize: sheetHandler.columns.shouldAnonymize(pathWithoutIndexes),
                  translate
                };

                // check for duplicates
                for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
                  // if not a duplicate header can jump over
                  const existingColumn = sheetHandler.columns.headerColumns[columnIndex];
                  if (existingColumn.originalHeader !== columnData.originalHeader) {
                    continue;
                  }

                  // duplicate header - append unique key
                  columnData.header = `${columnData.originalHeader} (${columnData.uniqueKeyInCaseOfDuplicate})`;
                  existingColumn.header = `${existingColumn.originalHeader} (${existingColumn.uniqueKeyInCaseOfDuplicate})`;

                  // continue to check for other duplicates & replace their header too
                }

                // append column
                sheetHandler.columns.headerColumns.push(columnData);

                // in case we need it
                return columnData;
              };

              // remove previous column if path condition is met
              const removeLastColumnIfSamePath = (path) => {
                // nothing to do
                if (sheetHandler.columns.headerColumns.length < 1) {
                  return;
                }

                // check if we need to remove it
                if (sheetHandler.columns.headerColumns[sheetHandler.columns.headerColumns.length - 1].path !== path) {
                  return;
                }

                // meets the criteria, need to remove column
                sheetHandler.columns.headerColumns.splice(
                  sheetHandler.columns.headerColumns.length - 1,
                  1
                );
              };

              // attach parent location identifiers
              const attachLocationIdentifiers = (
                header,
                headerFlatSuffix,
                path,
                pathWithoutIndexes
              ) => {
                // non flat ?
                if (sheetHandler.process.exportIsNonFlat) {
                  // attach location identifier
                  addHeaderColumn(
                    header,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].identifiers ?
                        sheetHandler.locationsMap[value].identifiersCodes :
                        [];
                    }
                  );

                  // finished
                  return;
                }

                // attach location identifiers
                for (let identifierIndex = 0; identifierIndex < sheetHandler.locationsMaxNumberOfIdentifiers; identifierIndex++) {
                  // attach location identifier
                  addHeaderColumn(
                    `${header} ${headerFlatSuffix} [${identifierIndex + 1}]`,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (function (localIdentifierIndex) {
                      return (value) => {
                        return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].identifiers &&
                        sheetHandler.locationsMap[value].identifiers.length > localIdentifierIndex ?
                          sheetHandler.locationsMap[value].identifiers[localIdentifierIndex].code :
                          '';
                      };
                    })(identifierIndex)
                  );
                }
              };

              // attach parent location details - only first level parent
              const attachParentLocationDetails = (
                header,
                path,
                pathWithoutIndexes
              ) => {
                // non flat ?
                if (sheetHandler.process.exportIsNonFlat) {
                  // attach parent location geographical level
                  addHeaderColumn(
                    header,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentChainGeoLvlArray ?
                        sheetHandler.locationsMap[value].parentChainGeoLvlArray :
                        [];
                    },
                    (value, pipeTranslator) => {
                      return sheetHandler.dontTranslateValues ?
                        value :
                        value.map(pipeTranslator);
                    }
                  );

                  // finished
                  return;
                }

                // attach parent location details - only first level parent
                for (let parentLocationIndex = 0; parentLocationIndex < sheetHandler.locationsMaxSizeOfParentsChain; parentLocationIndex++) {
                  // attach parent location geographical level
                  addHeaderColumn(
                    `${header} [${parentLocationIndex + 1}]`,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (function (localParentLocationIndex) {
                      return (value) => {
                        return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentChain &&
                        sheetHandler.locationsMap[value].parentChain.length > localParentLocationIndex &&
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]] &&
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].geographicalLevelId ?
                          sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].geographicalLevelId :
                          '';
                      };
                    })(parentLocationIndex)
                  );
                }
              };

              // get properties of type array definitions if current model has one
              const arrayProps = sheetHandler.process.exportIsNonFlat || _.isEmpty(modelOptions.arrayProps) ?
                undefined :
                modelOptions.arrayProps;

              // for faster then forEach :) - monumental gain :)
              for (let propIndex = 0; propIndex < sheetHandler.columns.headerKeys.length; propIndex++) {
                // get record data
                const propertyName = sheetHandler.columns.headerKeys[propIndex];
                const propertyLabelToken = sheetHandler.useDbColumns ?
                  undefined :
                  sheetHandler.columns.labels[propertyName];
                const propertyLabelTokenTranslation = propertyLabelToken && sheetHandler.dictionaryMap[propertyLabelToken] !== undefined ?
                  sheetHandler.dictionaryMap[propertyLabelToken] :
                  propertyName;

                // array property ?
                if (
                  arrayProps &&
                  arrayProps[propertyName]
                ) {
                  // go through each child property and create proper header columns
                  if (sheetHandler.columns.arrayColumnMaxValues[propertyName]) {
                    for (let arrayIndex = 0; arrayIndex < sheetHandler.columns.arrayColumnMaxValues[propertyName]; arrayIndex++) {
                      for (let childProperty in arrayProps[propertyName]) {
                        // determine child property information
                        const childPropertyTokenTranslation = sheetHandler.useDbColumns ?
                          childProperty :
                          sheetHandler.dictionaryMap[arrayProps[propertyName][childProperty]];

                        // child property contains parent info ?
                        const propertyOfAnObjectIndex = childProperty.indexOf('.');
                        if (propertyOfAnObjectIndex > -1) {
                          // determine parent property
                          const parentProperty = childProperty.substr(0, propertyOfAnObjectIndex);

                          // remove previous column if it was a parent column
                          if (parentProperty) {
                            removeLastColumnIfSamePath(`${propertyName}[${arrayIndex}].${parentProperty}`);
                          }
                        }

                        // add columns
                        const childColumn = addHeaderColumn(
                          `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}]`,
                          `${propertyName}[${arrayIndex}].${childProperty}`,
                          `${propertyName}[].${childProperty}`,
                          uuid.v4()
                        );

                        // if location column we need to push some extra columns
                        if (
                          sheetHandler.columns.includeParentLocationData &&
                          sheetHandler.columns.locationsFieldsMap[childColumn.pathWithoutIndexes]
                        ) {
                          // attach location guid
                          addHeaderColumn(
                            `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_ID']} [${arrayIndex + 1}]`,
                            `${propertyName}[${arrayIndex}].${childProperty}`,
                            childColumn.pathWithoutIndexes,
                            uuid.v4(),
                            (value) => {
                              return value;
                            }
                          );

                          // attach location identifiers
                          attachLocationIdentifiers(
                            `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']} [${arrayIndex + 1}]`,
                            sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIER'],
                            `${propertyName}[${arrayIndex}].${childProperty}`,
                            childColumn.pathWithoutIndexes
                          );

                          // attach parent location details - only first level parent
                          attachParentLocationDetails(
                            `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}] ${sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']}`,
                            `${propertyName}[${arrayIndex}].${childProperty}`,
                            childColumn.pathWithoutIndexes
                          );
                        }
                      }
                    }
                  }

                  // property addressed through its children, no need to continue, and yet we continue - dev joke :) - jump to next item in for loop
                  continue;
                }

                // do not handle array properties from field labels map when we have arrayProps set on the model
                const isPropertyOfAnArray = propertyName.indexOf('[]') > -1;
                if (
                  isPropertyOfAnArray &&
                  arrayProps
                ) {
                  continue;
                }

                // if a flat file is exported, data needs to be flattened, include 3 elements for each array
                if (isPropertyOfAnArray) {
                  // if non flat child columns are handled by parents
                  if (sheetHandler.process.exportIsNonFlat) {
                    continue;
                  }

                  // bad model configuration - missing definition
                  // #TODO
                  throw new Error(`Missing array definition for property '${propertyName}'`);
                } else {
                  // check if property belongs to an object
                  const propertyOfAnObjectIndex = propertyName.indexOf('.');
                  let parentProperty, parentPropertyTokenTranslation;
                  if (propertyOfAnObjectIndex > -1) {
                    parentProperty = propertyName.substr(0, propertyOfAnObjectIndex);
                    parentPropertyTokenTranslation = !sheetHandler.useDbColumns && parentProperty && sheetHandler.dictionaryMap[parentProperty] ?
                      sheetHandler.dictionaryMap[parentProperty] : (
                        sheetHandler.useDbColumns ?
                          parentProperty :
                          undefined
                      );
                  }

                  // if property belongs to an object then maybe we should remove the parent column since it isn't necessary anymore
                  if (parentProperty) {
                    // if non flat child columns are handled by parents
                    if (sheetHandler.process.exportIsNonFlat) {
                      // if non flat child columns are handled by parents
                      // nothing
                    } else {
                      // remove parent column
                      removeLastColumnIfSamePath(parentProperty);

                      // add column
                      if (parentPropertyTokenTranslation) {
                        addHeaderColumn(
                          `${parentPropertyTokenTranslation} ${propertyLabelTokenTranslation}`,
                          propertyName,
                          propertyName,
                          uuid.v4()
                        );
                      } else {
                        // add column
                        addHeaderColumn(
                          propertyLabelTokenTranslation,
                          propertyName,
                          propertyName,
                          uuid.v4()
                        );
                      }
                    }
                  } else {
                    // questionnaire column needs to be handled differently
                    if (
                      propertyName === defaultQuestionnaireAnswersKey &&
                      options.questionnaire &&
                      sheetHandler.questionnaireQuestionsData.nonFlat.length > 0
                    ) {
                      // non flat file types have just one column
                      if (sheetHandler.process.exportIsNonFlat) {
                        // value
                        addHeaderColumn(
                          propertyLabelTokenTranslation,
                          propertyName,
                          propertyName,
                          uuid.v4(),
                          (value) => {
                            // no processing ?
                            if (
                              sheetHandler.useDbColumns &&
                              sheetHandler.dontTranslateValues
                            ) {
                              return value;
                            }

                            // map and translate questions in proper order even if questionnaireAnswers is an object, and it won't keep the order, so same label questions will be confusing
                            const originalAnswersMap = {};
                            const formattedAnswers = {};
                            for (let questionIndex = 0; questionIndex < sheetHandler.questionnaireQuestionsData.flat.length; questionIndex++) {
                              // get record data
                              const questionData = sheetHandler.questionnaireQuestionsData.flat[questionIndex];

                              // question header
                              const questionHeader = sheetHandler.questionnaireUseVariablesAsHeaders || sheetHandler.useDbColumns ?
                                questionData.variable : (
                                  sheetHandler.dictionaryMap[questionData.text] ?
                                    sheetHandler.dictionaryMap[questionData.text] :
                                    questionData.text
                                );

                              // determine value
                              const finalValue = value ?
                                value[questionData.variable] :
                                undefined;

                              // process answer value
                              if (finalValue) {
                                // replace date / value labels
                                for (let answerIndex = 0; answerIndex < finalValue.length; answerIndex++) {
                                  // retrieve answer data
                                  const answer = finalValue[answerIndex];

                                  // replace single / multiple answers with labels instead of answer text
                                  // - needs to be before replacing value / date labels
                                  if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER') {
                                    if (
                                      !sheetHandler.dontTranslateValues &&
                                      answer.value
                                    ) {
                                      // answer to token
                                      answer.value = questionData.answerKeyToLabelMap[answer.value] ?
                                        questionData.answerKeyToLabelMap[answer.value] :
                                        answer.value;

                                      // translate if we have translation
                                      answer.value = sheetHandler.dictionaryMap[answer.value] ?
                                        sheetHandler.dictionaryMap[answer.value] :
                                        answer.value;
                                    }
                                  } else if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                                    // go through all dropdown answers
                                    if (
                                      !sheetHandler.dontTranslateValues &&
                                      answer.value &&
                                      answer.value.length
                                    ) {
                                      for (let multipleDropdownAnswerIndex = 0; multipleDropdownAnswerIndex < answer.value.length; multipleDropdownAnswerIndex++) {
                                        // answer to token
                                        answer.value[multipleDropdownAnswerIndex] = questionData.answerKeyToLabelMap[answer.value[multipleDropdownAnswerIndex]] ?
                                          questionData.answerKeyToLabelMap[answer.value[multipleDropdownAnswerIndex]] :
                                          answer.value[multipleDropdownAnswerIndex];

                                        // translate if we have translation
                                        answer.value[multipleDropdownAnswerIndex] = sheetHandler.dictionaryMap[answer.value[multipleDropdownAnswerIndex]] ?
                                          sheetHandler.dictionaryMap[answer.value[multipleDropdownAnswerIndex]] :
                                          answer.value[multipleDropdownAnswerIndex];
                                      }
                                    }
                                  }

                                  // replace value
                                  if (
                                    !sheetHandler.useDbColumns &&
                                    answer.hasOwnProperty('value')
                                  ) {
                                    answer[sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE'] ?
                                      sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE'] :
                                      'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE'
                                      ] = answer.value;
                                    delete answer.value;
                                  }

                                  // replace date
                                  if (
                                    !sheetHandler.useDbColumns &&
                                    answer.hasOwnProperty('date')
                                  ) {
                                    answer[sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'] ?
                                      sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'] :
                                      'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'
                                      ] = answer.date;
                                    delete answer.date;
                                  }
                                }
                              }

                              // do we have answers with same header ?
                              // - rename them
                              if (originalAnswersMap[questionHeader]) {
                                // rename previous answers if not named already
                                if (formattedAnswers.hasOwnProperty(questionHeader)) {
                                  // this changes the order, but it doesn't matter since in objects..order isn't guaranteed
                                  formattedAnswers[`${questionHeader} (${originalAnswersMap[questionHeader]})`] = formattedAnswers[questionHeader];
                                  delete formattedAnswers[questionHeader];
                                }

                                // attach current answer
                                formattedAnswers[`${questionHeader} (${questionData.variable})`] = finalValue;
                              } else {
                                // attach answer
                                formattedAnswers[questionHeader] = finalValue;

                                // make sure we know this header was used
                                originalAnswersMap[questionHeader] = questionData.variable;
                              }
                            }

                            // finished
                            return formattedAnswers;
                          }
                        );
                      } else {
                        // add questionnaire columns - flat file
                        const addQuestionnaireColumns = (questionData) => {
                          // determine number of responses for this question
                          const queryKey = getQuestionnaireQuestionUniqueKey(questionData.variable);
                          let maxNoOfResponsesForThisQuestion = sheetHandler.columns.arrayColumnMaxValues[queryKey] ?
                            sheetHandler.columns.arrayColumnMaxValues[queryKey] :
                            0;

                          // we should export at least one round of columns even if we don't have data
                          maxNoOfResponsesForThisQuestion = maxNoOfResponsesForThisQuestion < 1 ?
                            1 :
                            maxNoOfResponsesForThisQuestion;

                          // we need to add question to which we don't have answers (we shouldn't have these cases)
                          // - because otherwise you will see child questions that you don't know for which parent question they were
                          // add number of column necessary to export all responses
                          for (let answerIndex = 0; answerIndex < maxNoOfResponsesForThisQuestion; answerIndex++) {
                            // question header
                            const questionHeader = sheetHandler.questionnaireUseVariablesAsHeaders || sheetHandler.useDbColumns ?
                              questionData.variable : (
                                sheetHandler.dictionaryMap[questionData.text] ?
                                  sheetHandler.dictionaryMap[questionData.text] :
                                  questionData.text
                              );

                            // multiple dropdown ?
                            if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                              // determine number of max responses
                              const queryKeyForMultiple = getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable);
                              let maxNoOfResponsesForThisMultipleQuestion = sheetHandler.columns.arrayColumnMaxValues[queryKeyForMultiple] ?
                                sheetHandler.columns.arrayColumnMaxValues[queryKeyForMultiple] :
                                0;

                              // we should export at least one round of columns even if we don't have data
                              maxNoOfResponsesForThisMultipleQuestion = maxNoOfResponsesForThisMultipleQuestion < 1 ?
                                1 :
                                maxNoOfResponsesForThisMultipleQuestion;

                              // date needs to be printed just once
                              addHeaderColumn(
                                `${questionHeader} [MD ${answerIndex + 1}]`,
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                                questionData.variable
                              );

                              // attach responses
                              for (let multipleAnswerIndex = 0; multipleAnswerIndex < maxNoOfResponsesForThisMultipleQuestion; multipleAnswerIndex++) {
                                // value
                                addHeaderColumn(
                                  `${questionHeader} [MV ${answerIndex + 1}] ${multipleAnswerIndex + 1}`,
                                  `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value[${multipleAnswerIndex}]`,
                                  `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value[${multipleAnswerIndex}]`,
                                  questionData.variable,
                                  (function (localQuestionData) {
                                    return (value) => {
                                      return !sheetHandler.dontTranslateValues && localQuestionData.answerKeyToLabelMap[value] ?
                                        localQuestionData.answerKeyToLabelMap[value] :
                                        value;
                                    };
                                  })(questionData)
                                );
                              }
                            } else {
                              // date
                              addHeaderColumn(
                                `${questionHeader} [MD ${answerIndex + 1}]`,
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`,
                                questionData.variable
                              );

                              // value
                              addHeaderColumn(
                                `${questionHeader} [MV ${answerIndex + 1}]`,
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value`,
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value`,
                                questionData.variable,
                                (function (localQuestionData) {
                                  return (value) => {
                                    return !sheetHandler.dontTranslateValues && localQuestionData.answerKeyToLabelMap[value] ?
                                      localQuestionData.answerKeyToLabelMap[value] :
                                      value;
                                  };
                                })(questionData)
                              );
                            }

                            // need to add child question columns before adding next index column for this question - to keep order of responses for each question
                            questionData.childQuestions.forEach((childQuestion) => {
                              addQuestionnaireColumns(childQuestion);
                            });
                          }
                        };

                        // construct columns for our questionnaire
                        sheetHandler.questionnaireQuestionsData.nonFlat.forEach((questionData) => {
                          addQuestionnaireColumns(questionData);
                        });
                      }
                    } else {
                      // add normal column
                      addHeaderColumn(
                        propertyLabelTokenTranslation,
                        propertyName,
                        propertyName,
                        uuid.v4(),
                        !sheetHandler.process.exportIsNonFlat ?
                          undefined :
                          (function (localPropertyName) {
                            return (value, translatePipe) => {
                              // no processing ?
                              if (
                                sheetHandler.useDbColumns &&
                                sheetHandler.dontTranslateValues
                              ) {
                                return value;
                              }

                              // for non flat file types we might need to translate / format value
                              // - array condition must be before object since array ...is an object too...
                              if (
                                value && (
                                  Array.isArray(value) ||
                                  typeof value === 'object'
                                )
                              ) {
                                // format property value
                                const format = (
                                  prefix,
                                  childValue
                                ) => {
                                  // no value ?
                                  if (!childValue) {
                                    return childValue;
                                  }

                                  // response
                                  let response;

                                  // array ?
                                  if (Array.isArray(childValue)) {
                                    // initialize response
                                    response = [];

                                    // start formatting every item
                                    for (let arrayIndex = 0; arrayIndex < childValue.length; arrayIndex++) {
                                      response.push(
                                        format(
                                          `${prefix}[]`,
                                          childValue[arrayIndex]
                                        )
                                      );
                                    }
                                  } else if (
                                    typeof childValue === 'object' &&
                                    !(childValue instanceof Date)
                                  ) {
                                    // initialize object
                                    response = {};

                                    // go through each property and translate both key & value
                                    for (const propertyKey in childValue) {
                                      // check if we have a label for property
                                      const path = `${prefix}.${propertyKey}`;
                                      const propPath = sheetHandler.useDbColumns ?
                                        undefined :
                                        sheetHandler.columns.labels[path];
                                      const propPathTranslation = propPath && sheetHandler.dictionaryMap[propPath] ?
                                        sheetHandler.dictionaryMap[propPath] :
                                        propertyKey;

                                      // check if value is location type
                                      if (
                                        childValue[propertyKey] &&
                                        typeof childValue[propertyKey] === 'string' &&
                                        sheetHandler.columns.locationsFieldsMap[path]
                                      ) {
                                        // need to replace location id with location name ?
                                        const locationValue = childValue[propertyKey];
                                        response[propPathTranslation] = sheetHandler.locationsMap[locationValue] ?
                                          sheetHandler.locationsMap[locationValue].name :
                                          locationValue;

                                        // attach location identifiers
                                        response[sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']] = sheetHandler.locationsMap[locationValue] && sheetHandler.locationsMap[locationValue].identifiers ?
                                          sheetHandler.locationsMap[locationValue].identifiersCodes :
                                          [];

                                        // attach parent location details - only first level parent
                                        response[sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']] = sheetHandler.locationsMap[locationValue] && sheetHandler.locationsMap[locationValue].parentChainGeoLvlArray ?
                                          sheetHandler.locationsMap[locationValue].parentChainGeoLvlArray.map(translatePipe) :
                                          [];
                                      } else {
                                        // set value
                                        response[propPathTranslation] = format(
                                          path,
                                          childValue[propertyKey]
                                        );
                                      }
                                    }
                                  } else {
                                    // normal value
                                    response = !sheetHandler.dontTranslateValues && childValue &&
                                    typeof childValue === 'string' && childValue.startsWith('LNG_') ?
                                      translatePipe(childValue) :
                                      childValue;
                                  }

                                  // finished
                                  return response;
                                };

                                // start formatting
                                return format(
                                  localPropertyName,
                                  value
                                );
                              }

                              // no custom formatter
                              return value;
                            };
                          })(propertyName)
                      );
                    }
                  }

                  // location field ?
                  if (
                    sheetHandler.columns.includeParentLocationData &&
                    sheetHandler.columns.locationsFieldsMap[propertyName]
                  ) {
                    // attach location identifiers
                    attachLocationIdentifiers(
                      `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']}`,
                      sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIER'],
                      propertyName,
                      propertyName
                    );

                    // attach parent location details - only first level parent
                    attachParentLocationDetails(
                      `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']}`,
                      propertyName,
                      propertyName
                    );
                  }
                }
              }

              // finished
              sheetHandler.process.setColumns();
            });
        };

        // determine next batch of rows that we need to export
        const determineBatchOfRecordsToExport = (batchSize) => {
          return temporaryCollection
            .find(
              {}, {
                limit: batchSize,
                projection: {
                  _id: 1,
                  rowId: 1
                }
              }
            )
            .toArray();
        };

        // retrieve batch of rows to export
        const retrieveBatchToExport = (records) => {
          // do we have something to retrieve ?
          records = records || [];
          const rowIdsToRetrieve = records.map((record) => record.rowId);
          return records.length < 1 ?
            [] :
            (exportDataCollection
              .find({
                _id: {
                  $in: rowIdsToRetrieve
                }
              }, {
                projection: sheetHandler.projection
              })
              .toArray()
              .then((recordsToExport) => {
                // delete records from temporary collection so we don't export them again
                return temporaryCollection
                  .deleteMany({
                    _id: {
                      $in: records.map((record) => record._id)
                    }
                  })
                  .then(() => {
                    // map for easy access because we need to keep order from rowIdsToRetrieve
                    const recordsToExportMap = {};
                    for (let recordIndex = 0; recordIndex < recordsToExport.length; recordIndex++) {
                      recordsToExportMap[recordsToExport[recordIndex]._id] = recordsToExport[recordIndex];
                    }

                    // finished
                    return {
                      records: recordsToExportMap,
                      order: rowIdsToRetrieve
                    };
                  });
              }));
        };

        // retrieve data like missing tokens ...
        // all locations should've been retrieved above - location initialization
        const writeDataToFileDetermineMissingData = (data) => {
          // missing data definitions
          const missingData = {
            tokens: {}
          };

          // since all we do here is to retrieve missing tokens for now
          // - if values don't need to be translated then there is no point in continuing
          if (sheetHandler.dontTranslateValues) {
            return missingData;
          }

          // retrieve missing data
          // faster than a zombie
          for (let recordIndex = 0; recordIndex < data.order.length; recordIndex++) {
            // get record data
            const record = data.records[data.order[recordIndex]];

            // record doesn't exist anymore - deleted ?
            if (!record) {
              continue;
            }

            // determine missing data
            for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
              // get data
              const column = sheetHandler.columns.headerColumns[columnIndex];

              // if column is anonymize then there is no need to retrieve data for this cell
              if (column.anonymize) {
                continue;
              }

              // do we have a formula ?
              let cellValue;
              if (column.formula) {
                // retrieve result from formula
                cellValue = column.formula(
                  _.get(record, column.path),
                  (token) => {
                    // add to translate if necessary
                    if (!sheetHandler.dictionaryMap[token]) {
                      missingData.tokens[token] = true;
                    }

                    // no need to return translation at this point
                    // nothing
                  }
                );
              } else {
                // determine value from column path
                cellValue = _.get(
                  record,
                  column.path
                );
              }

              // check if we have missing tokens, locations ...
              if (
                cellValue &&
                typeof cellValue === 'string'
              ) {
                // missing token ?
                if (cellValue.startsWith('LNG_')) {
                  if (!sheetHandler.dictionaryMap[cellValue]) {
                    missingData.tokens[cellValue] = true;
                  }
                }
              } else if (
                // custom token generator ?
                column.translate
              ) {
                column.translate(
                  cellValue,
                  (token) => {
                    // add to translate if necessary
                    if (!sheetHandler.dictionaryMap[token]) {
                      missingData.tokens[token] = true;
                    }

                    // no need to return translation at this point
                    // nothing
                  }
                );
              }
            }
          }

          // finished
          return missingData;
        };

        // handle write data to file
        const writeDataToFile = (data) => {
          // for context sake,need to define it locally
          // - promise visibility
          const recordData = data;

          // determine missing data like tokens, locations, ...
          // - the order doesn't matter here
          const missingData = writeDataToFileDetermineMissingData(recordData);

          // retrieve necessary data & write record to file
          return Promise.resolve()
            // retrieve missing language tokens & write data
            .then(() => {
              // no missing tokens ?
              if (_.isEmpty(missingData.tokens)) {
                return;
              }

              // retrieve missing tokens
              return retrieveMissingTokens(
                sheetHandler.languageId,
                Object.keys(missingData.tokens)
              );
            })

            // write row to file
            .then(() => {
              // write data to file
              // - keep order from sort
              // - since next record increments at the start, to get first item we need to start with -1
              let recordIndex = -1;
              const nextRecord = () => {
                // next record
                recordIndex++;

                // finished ?
                if (recordIndex >= recordData.order.length) {
                  return Promise.resolve();
                }

                // processed
                sheetHandler.processedNo++;

                // get record data
                const record = recordData.records[recordData.order[recordIndex]];

                // record doesn't exist anymore - deleted ?
                if (!record) {
                  return Promise.resolve();
                }

                // convert geo-points (if any)
                genericHelpers.covertAddressesGeoPointToLoopbackFormat(record);

                // go through data and add create data array taking in account columns order
                const dataArray = [], dataObject = {};
                for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
                  // get data
                  const column = sheetHandler.columns.headerColumns[columnIndex];

                  // if column is anonymize then there is no need to retrieve data for this cell
                  if (column.anonymize) {
                    // non flat data ?
                    if (sheetHandler.process.exportIsNonFlat) {
                      dataObject[column.header] = sheetHandler.columns.anonymizeString;
                    } else {
                      dataArray.push(sheetHandler.columns.anonymizeString);
                    }

                    // next column
                    continue;
                  }

                  // do we have a formula ?
                  let cellValue;
                  if (column.formula) {
                    cellValue = column.formula(
                      _.get(record, column.path),
                      (token) => {
                        // go through pipe
                        return !sheetHandler.dontTranslateValues && sheetHandler.dictionaryMap[token] ?
                          sheetHandler.dictionaryMap[token] :
                          token;
                      }
                    );
                  } else {
                    // determine value from column path
                    cellValue = _.get(
                      record,
                      column.path
                    );

                    // need to replace location id with location name ?
                    if (
                      cellValue &&
                      typeof cellValue === 'string' &&
                      sheetHandler.columns.locationsFieldsMap[column.pathWithoutIndexes]
                    ) {
                      cellValue = sheetHandler.locationsMap[cellValue] ?
                        sheetHandler.locationsMap[cellValue].name :
                        cellValue;
                    }
                  }

                  // process data applies for all
                  // - formulas & values
                  if (
                    !sheetHandler.dontTranslateValues &&
                    cellValue
                  ) {
                    // translate
                    if (
                      typeof cellValue === 'string' &&
                      cellValue.startsWith('LNG_')
                    ) {
                      cellValue = sheetHandler.dictionaryMap[cellValue] !== undefined ?
                        sheetHandler.dictionaryMap[cellValue] :
                        cellValue;
                    } else if (
                      // custom token generator ?
                      column.translate
                    ) {
                      cellValue = column.translate(
                        cellValue,
                        (token) => {
                          // go through pipe
                          return sheetHandler.dictionaryMap[token] ?
                            sheetHandler.dictionaryMap[token] :
                            token;
                        }
                      );
                    }

                    // format dates
                    if (cellValue instanceof Date) {
                      cellValue = moment(cellValue).toISOString();
                    }
                  }

                  // add value to row
                  if (sheetHandler.process.exportIsNonFlat) {
                    dataObject[column.header] = cellValue;
                  } else {
                    dataArray.push(cellValue);
                  }
                }

                // append row
                return sheetHandler.process
                  .addRow(sheetHandler.process.exportIsNonFlat ?
                    dataObject :
                    dataArray
                  )
                  .then(nextRecord);
              };

              // start row writing
              return nextRecord()
                .then(() => {
                  // update export log
                  return sheetHandler.updateExportLog({
                    processedNo: sheetHandler.processedNo,
                    updatedAt: new Date()
                  });
                });
            });
        };

        // process data in batches
        return genericHelpers.handleActionsInBatches(
          () => {
            // create export log entry
            return initializeExportLog()
              // retrieve general language tokens
              .then(initializeLanguageTokens)

              // change export status => Preparing records
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_PREPARING_RECORDS',
                  updatedAt: new Date()
                });
              })

              // generate temporary collection - view
              .then(initializeCollectionView)

              // change export status => Preparing locations
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_PREPARING_LOCATIONS',
                  aggregateCompletionDate: new Date(),
                  updatedAt: new Date()
                });
              })

              // retrieve locations
              .then(initializeLocations)

              // change export status => Preparing column headers
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_CONFIGURE_HEADERS',
                  updatedAt: new Date()
                });
              })

              // generate column headers
              .then(initializeColumns)

              // count number of records that we need to export
              .then(() => {
                return temporaryCollection.countDocuments();
              })
              .then((counted) => {
                // change export status => Starting to export data
                return sheetHandler.updateExportLog(
                  {
                    totalNo: counted,
                    statusStep: 'LNG_STATUS_STEP_EXPORTING_RECORDS',
                    updatedAt: new Date()
                  })
                  .then(() => {
                    // start the actual exporting of data
                    return counted;
                  });
              });
          },
          (batchNo, batchSize) => {
            // get row records that we need to export from temporary collection
            // order is natual, which should be the order they were added on, so basically aggregate $sort order - resulting in order from client
            return determineBatchOfRecordsToExport(batchSize)
              .then(retrieveBatchToExport);
          },
          writeDataToFile,
          null,
          sheetHandler.batchSize,
          0,
          console
        );
      })
      .then(() => {
        // should've exported all records - redundant but better check
        return temporaryCollection
          .countDocuments()
          .then((counted) => {
            if (counted > 0) {
              throw new Error('Not all documents were exported');
            }
          });
      })
      .then(sheetHandler.process.finalize)
      .then(() => {
        // drop temporary collection since we finished the export and we don't need it anymore
        return dropTemporaryCollection();
      })
      .then(encryptFiles)
      .then(zipIfMultipleFiles)
      .then(() => {
        // finished exporting data
        return sheetHandler.updateExportLog({
          status: 'LNG_SYNC_STATUS_SUCCESS',
          statusStep: 'LNG_STATUS_STEP_EXPORT_FINISHED',
          updatedAt: new Date(),
          actionCompletionDate: new Date()
        });
      })
      .then(() => {
        // finished - stop worker
        parentCallback(null, {
          subject: 'KILL'
        });
      })
      .catch((err) => {
        sheetHandler.updateExportLog(
          {
            status: 'LNG_SYNC_STATUS_FAILED',
            // statusStep - keep as it is because it could help to know where it failed, on what step
            error: err.message,
            errStack: err.stack,
            updatedAt: new Date()
          })

          // remove temporary collection if it was created ?
          .then(dropTemporaryCollection)

          // remove file if generated
          .then(deleteTemporaryFile)

          // update export log to contain errors
          .then(() => {
            // throw parent error
            parentCallback(err);
          })
          .catch(() => {
            // throw parent error
            parentCallback(err);
          });
      });
  } catch (err) {
    // something went wrong - stop worker
    parentCallback(err);
  }
}

// exported constants & methods
module.exports = {
  // constants
  TEMPORARY_DATABASE_PREFIX,

  // methods
  exportFilteredModelsList
};
