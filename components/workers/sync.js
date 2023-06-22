'use strict';

const MongoClient = require('mongodb').MongoClient;
const async = require('async');
const tmp = require('tmp');
const archiver = require('archiver');
const fs = require('fs');
const Moment = require('moment');
const path = require('path');
const extractZip = require('extract-zip');
const _ = require('lodash');
const uuid = require('uuid');

const logger = require('./../logger')(true);
const dbSync = require('./../dbSync');
const workerRunner = require('./../workerRunner');
const dbConfig = require('./../../server/datasources').mongoDb;
const convertLoopbackFilterToMongo = require('../../components/convertLoopbackFilterToMongo');

const noElementsInFilterArrayLimit = 20000;

/**
 * Create ZIP archive of a file/dir
 * @param fileName
 * @param archiveName
 * @param logger
 * @returns {Promise<any>}
 */
function createZipArchive(fileName, archiveName, logger) {
  return new Promise(function (resolve, reject) {
    // compress all collection files from the tmp dir into .zip file
    logger.debug('Creating zip file');
    let output = fs.createWriteStream(archiveName);
    let archive = archiver('zip');

    // listen for all archive data to be written
    // 'close' event is fired only when a file descriptor is involved
    output.on('close', function () {
      // log archive name location
      logger.debug(`Archive created at '${archiveName}'. Size: ${archive.pointer()} bytes'`);
      resolve(archiveName);
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on('warning', function (err) {
      logger.debug('Archive warning' + err);
    });

    // good practice to catch this error explicitly
    archive.on('error', function (err) {
      logger.debug('Archive error' + err);
      reject(err);
    });

    // pipe archive data to the file
    archive.pipe(output);

    if (fs.statSync(fileName).isDirectory()) {
      // append files from a sub-directory, putting its contents at the root of archive
      archive.directory(fileName, false);
    } else {
      // archive given file
      archive.file(fileName, {name: path.basename(fileName)});
    }

    // finalize the archive (ie we are done appending files but streams have to finish yet)
    archive.finalize();
  });
}

/**
 * Create MongoDB connection and return it
 * @returns {Promise<Db | never>}
 */
function getMongoDBConnection() {
  // make sure it doesn't timeout
  let mongoOptions = {
    keepAlive: true,
    connectTimeoutMS: 1800000, // 30 minutes
    socketTimeoutMS: 1800000 // 30 minutes
  };

  // attach auth credentials
  if (dbConfig.password) {
    mongoOptions = Object.assign(mongoOptions, {
      auth: {
        username: dbConfig.user,
        password: dbConfig.password
      },
      authSource: dbConfig.authSource
    });
  }

  // retrieve mongodb connection
  return MongoClient
    .connect(`mongodb://${dbConfig.host}:${dbConfig.port}`, mongoOptions)
    .then(function (client) {
      return client
        .db(dbConfig.database);
    });
}

/**
 * Export a collection in batches
 * @param dbConnection
 * @param mongoCollectionName
 * @param collectionName
 * @param filter
 * @param batchSize
 * @param tmpDirName
 * @param archivesDirName
 * @param options
 * @param callback
 * @returns {Promise<any>}
 */
function exportCollectionInBatches(
  dbConnection,
  mongoCollectionName,
  collectionName,
  filterOrArrayOfFilters,
  batchSize,
  tmpDirName,
  archivesDirName,
  options,
  callback
) {
  // go through filters
  filterOrArrayOfFilters = Array.isArray(filterOrArrayOfFilters) ?
    filterOrArrayOfFilters :
    [filterOrArrayOfFilters];

  // next filter from list
  let batchNumber = -1;
  const nextFilter = (filterIndex = 0) => {
    // finished ?
    if (filterIndex >= filterOrArrayOfFilters.length) {
      // finish
      logger.debug(`Collection '${collectionName}' export success.`);
      return callback();
    }

    // retrieve current filter
    let filter = filterOrArrayOfFilters[filterIndex];

    // should we exclude deleted records ?
    if (
      !options.noDataFiltering &&
      options.applyExcludeDeletedRecordsRules &&
      dbSync.collectionsExcludeDeletedRecords &&
      dbSync.collectionsExcludeDeletedRecords[collectionName]
    ) {
      // query
      const notDeletedQuery = {
        deleted: false
      };

      // add to filter
      if (_.isEmpty(filter)) {
        filter = notDeletedQuery;
      } else {
        filter = {
          $and: [
            notDeletedQuery,
            filter
          ]
        };
      }
    }

    /**
     * Get next batch from collection
     * @param skip
     */
    const getNextBatch = (skip = 0) => {
      // batch number
      batchNumber++;

      // retrieve data
      let cursor = dbConnection
        .collection(mongoCollectionName)
        .find(filter, {
          skip: skip,
          limit: batchSize
        });

      // retrieve
      cursor
        .toArray()
        .then(function (records) {
          // if it was not requested to export empty collections
          const recordsCount = records && records.length ? records.length : 0;
          if (
            !options.exportEmptyCollections &&
            recordsCount < 1
          ) {
            // batch not written, can revert to previous
            batchNumber--;

            // next filter
            return nextFilter(filterIndex + 1);
          }

          // export for upstream server needs to obfuscate some information
          if (options.dbForUpstreamServer && recordsCount && dbSync.collectionsAlterDataMap[collectionName]) {
            dbSync.collectionsAlterDataMap[collectionName](records);
          }

          // export related files
          // if collection is not supported, it will be skipped
          dbSync.exportCollectionRelatedFiles(collectionName, records, archivesDirName, logger, options.password, (err) => {
            if (err) {
              logger.debug(`Collection '${collectionName}' related files export failed. Error: ${err}`);
              return callback(err);
            }

            // at least one collection has data to pack in an archive
            options.hasDataToExport = true;

            let fileName = `${collectionName}.${batchNumber}.json`;
            let filePath = `${tmpDirName}/${fileName}`;

            // create a file with collection name as file name, containing results
            fs.writeFile(filePath, JSON.stringify(records, null, 2), function () {
              // archive file
              let archiveFileName = `${archivesDirName}/${fileName}.zip`;
              createZipArchive(filePath, archiveFileName, logger)
                .then(function () {
                  // encrypt archived file if needed
                  if (options.password) {
                    // password provided, encrypt archive
                    logger.debug(`Encrypting '${archiveFileName}'.`);
                    return workerRunner
                      .helpers
                      .encryptFile(options.password, {}, archiveFileName);
                  } else {
                    // no password provided, return file path as is
                    return Promise.resolve();
                  }
                })
                .then(function () {
                  if (records.length < batchSize) {
                    // finish
                    return nextFilter(filterIndex + 1);
                  } else {
                    // continue with next batch
                    logger.debug(`Exported batch ${batchNumber} of collection '${collectionName}'.`);
                    return getNextBatch(skip + batchSize);
                  }
                })
                .catch(function (err) {
                  logger.debug(`Failed to export batch ${batchNumber} of collection '${collectionName}': ${err}`);
                  return callback(err);
                });
            });
          });
        })
        .catch(function (err) {
          logger.debug(`Collection '${collectionName}' export failed. Error: ${err}`);
          return callback(err);
        });
    };

    // start collection export
    getNextBatch();
  };

  // start filtering
  nextFilter();
}

const worker = {
  /**
   * Export collections and create ZIP file
   * @param collections
   * @param options Includes customFilter, filter, password
   * @returns {Promise<any | never>}
   */
  exportCollections: function (collections, options) {
    // initialize mongodb connection
    return getMongoDBConnection()
      .then(function (dbConnection) {
        return new Promise(function (resolve, reject) {
          let tmpDir, tmpDirName, archivesDirName;

          try {
            // create a temporary directory to store the database files
            // it always created the folder in the system temporary directory
            tmpDir = tmp.dirSync();
            tmpDirName = tmpDir.name;
            // also create an archives subdir
            archivesDirName = `${tmpDirName}/archives`;
            fs.mkdirSync(archivesDirName);
          } catch (err) {
            logger.error(`Failed creating tmp directories; ${err}`);
            return reject(err);
          }

          // flag that indicates if there is at least one collection with records
          // if this is not true, do not pack the main archive
          options.hasDataToExport = false;

          let filter = options.filter;
          let customFilter = null;

          // check for no data filtering option; is currently sent only on backups
          let filterDataGathering = Promise.resolve();
          if (!options.noDataFiltering) {
            // parse from date filter
            if (filter.where.hasOwnProperty('fromDate')) {
              // doing this because createdAt and updatedAt are equal when a record is created
              customFilter = {
                '$or': [
                  {
                    'updatedAt': {
                      $gte: new Date(filter.where.fromDate)
                    }
                  }, {
                    'dbUpdatedAt': {
                      $gte: new Date(filter.where.fromDate)
                    }
                  }
                ]
              };
            }

            // retrieve active cases and all their related contacts
            // Contacts: We transfer to mobile app all contacts belonging to the team that user us assigned to where the final follow-up status is “Under follow-up”,
            //    irrespective of the follow-up dates. Once we sync contacts and they end their follow-up, they will remain on the mobile device and clearly marked with
            //    “Follow-up complete” or “Lost to follow-up” should latter happen. From the point when their status is not any longer “Under follow-up” they are not
            //    included on the follow-up lists, but their historical follow-up data remain.
            // Cases: All cases to whom contacts as described above are exposed. In addition any cases who reside in the location which is responsibility of the team
            //    that user is assigned to.
            // Events: All events to which contacts as described above are exposed OR where the event occurred in a location which is responsibility of the team that
            //    the user is assigned to.
            // Contact of Contacts: All contact of contacts related to retrieved contacts
            filterDataGathering = filterDataGathering
              // retrieve outbreaks
              .then(() => {
                // should we retrieve information about all outbreaks or just some of them
                let outbreakFilter;
                const outbreakIds = _.get(options, 'filter.where.outbreakId');
                if (!_.isEmpty(outbreakIds)) {
                  outbreakFilter = {
                    _id: typeof outbreakIds === 'string' ?
                      outbreakIds :
                      convertLoopbackFilterToMongo(outbreakIds),
                    deleted: false
                  };
                } else {
                  outbreakFilter = {
                    deleted: false
                  };
                }

                // retrieve outbreaks
                // make sure outbreak exists
                return dbConnection
                  .collection(dbSync.collectionsMap.outbreak)
                  .find(
                    outbreakFilter, {
                      projection: {
                        _id: 1
                      }
                    }
                  )
                  .toArray()
                  .then((outbreaks) => {
                    // define object to perpetuate data to other promises
                    return {
                      outbreaks: _.transform(
                        outbreaks,
                        (acc, outbreak) => {
                          acc[outbreak._id] = outbreak;
                        },
                        {}
                      )
                    };
                  });
              })

              // retrieve outbreak cases
              .then((response) => {
                // retrieve only persons that belong to one of our outbreaks
                // if no outbreaks are provided, then it means that we have access to all outbreaks, so we need to retrieve all persons
                // retrieve deleted records too since we need to tell mobile that records were deleted
                const outbreakIds = Object.keys(response.outbreaks);
                let personFilter = {
                  outbreakId: {
                    $in: outbreakIds
                  }
                };

                // to avoid issues with filter size because of the locationsIds length make multiple requests to mongo
                let personFiltersChunks = [];

                // initialize response
                response.cases = {};
                response.contacts = {};
                response.events = {};
                response.contactsOfContacts = {};
                response.relationships = {};

                // check for filter locationsIds and filter teamIds; both or none will be present
                // when present we need to filter persons and all person related data based on location
                // initialize filter data gathering promise
                // IMPORTANT:
                // - filters out contacts that aren't from these locations
                // - it won't mark a case as being active even if one of its contacts is still under follow-up if that contact isn't from these locations
                if (
                  filter.where.locationsIds &&
                  filter.where.teamsIds
                ) {
                  // split locationsIds list in chunks
                  const locationsChunks = _.chunk(filter.where.locationsIds, noElementsInFilterArrayLimit);
                  locationsChunks.forEach(locationsIds => {
                    personFiltersChunks.push({
                      $and: [
                        {
                          $or: [
                            {
                              type: {
                                $ne: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                              }
                            }, {
                              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                              'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'
                            }
                          ]
                        }, {
                          $or: [
                            {
                              type: {
                                $in: [
                                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
                                ]
                              },
                              $or: [
                                {
                                  addresses: {
                                    $elemMatch: {
                                      typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
                                      $or: [
                                        {
                                          locationId: null
                                        }, {
                                          locationId: {
                                            $in: locationsIds
                                          }
                                        }
                                      ]
                                    }
                                  }
                                }, {
                                  'addresses.typeId': {
                                    $ne: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE'
                                  }
                                }
                              ]
                            }, {
                              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT',
                              $or: [
                                {
                                  'address.typeId': {
                                    $ne: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE'
                                  }
                                }, {
                                  'address.typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
                                  $or: [
                                    {
                                      'address.locationId': null
                                    }, {
                                      'address.locationId': {
                                        $in: locationsIds
                                      }
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        },
                        personFilter
                      ]
                    });
                  });
                } else {
                  personFiltersChunks.push(personFilter);
                }

                // retrieve outbreak persons; making multiple requests if multiple filters were constructed
                return new Promise((resolve, reject) => {
                  async
                    .eachLimit(personFiltersChunks, 5, (filterChunk, asyncCallback) => {
                      return dbConnection
                        .collection(dbSync.collectionsMap.person)
                        .find(
                          filterChunk, {
                            projection: {
                              // common fields ( case / contact / event )
                              _id: 1,
                              type: 1
                            }
                          }
                        )
                        .toArray()
                        .then((chunkRecords) => {
                          // loop through the personsIds to get contactIds / caseIds / eventIds
                          // & cache IDs on filter for future usage
                          // - contacts is an object because we need to easily find later a contact by id ( dictionary )
                          // - events is an object, because even if now we don't have duplicates, later we will add other event ids that could already be in the list of ids
                          //    - so this is an easy way to remove duplicates
                          chunkRecords.forEach((person) => {
                            switch (person.type) {
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT':
                                response.contacts[person._id] = true;
                                break;
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE':
                                response.cases[person._id] = true;
                                break;
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT':
                                response.events[person._id] = true;
                                break;
                            }
                          });

                          // finished
                          asyncCallback();
                        })
                        .catch(asyncCallback);
                    }, (err) => {
                      // error ?
                      if (err) {
                        return reject(err);
                      }

                      // finished
                      return resolve(response);
                    });
                });
              })

              // retrieve contacts relationships
              .then((response) => {
                // there is nothing to retrieve ?
                if (_.isEmpty(response.contacts)) {
                  return response;
                }

                // retrieve relationships to our contacts
                // since _ids are unique, there is no need to add outbreaks filter since we do that already for contacts, and here we retrieve only relationships for these contacts
                const contactRecordsIds = Object.keys(response.contacts);

                // to avoid issues with filter size because of the contactRecordsIds length make multiple requests to mongo
                // retrieve deleted records too since we need to tell mobile that records were deleted
                return new Promise((resolve, reject) => {
                  async
                    .eachLimit(_.chunk(contactRecordsIds, noElementsInFilterArrayLimit), 5, (contactIdsChunk, asyncCallback) => {
                      // retrieve case contacts relationships
                      return dbConnection
                        .collection(dbSync.collectionsMap.relationship)
                        .find({
                          'persons.id': {
                            $in: contactIdsChunk
                          }
                        }, {
                          projection: {
                            _id: 1,
                            persons: 1
                          }
                        })
                        .toArray()
                        .then((chunkRecords) => {
                          // get relationships
                          chunkRecords.forEach((relationship) => {
                            // something went wrong, we have invalid data
                            // jump over this record
                            if (
                              !relationship.persons ||
                              relationship.persons.length !== 2
                            ) {
                              return;
                            }

                            // determine id for which we might need to retrieve person data
                            let relatedId;
                            let relatedType;
                            if (
                              relationship.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' &&
                              response.contacts[relationship.persons[0].id]
                            ) {
                              relatedId = relationship.persons[1].id;
                              relatedType = relationship.persons[1].type;
                            } else {
                              relatedId = relationship.persons[0].id;
                              relatedType = relationship.persons[0].type;
                            }

                            // determine persons for which we need to retrieve data
                            // add relationship to list of relationships to sync
                            switch (relatedType) {
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT':
                                response.contacts[relatedId] = true;
                                response.relationships[relationship._id] = true;
                                break;
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE':
                                response.cases[relatedId] = true;
                                response.relationships[relationship._id] = true;
                                break;
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT':
                                response.events[relatedId] = true;
                                response.relationships[relationship._id] = true;
                                break;
                              case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT':
                                response.contactsOfContacts[relatedId] = true;
                                response.relationships[relationship._id] = true;
                                break;
                            }
                          });

                          // finished with this chunk
                          asyncCallback();
                        })
                        .catch(asyncCallback);
                    }, (err) => {
                      // error ?
                      if (err) {
                        return reject(err);
                      }

                      // finished
                      return resolve(response);
                    });
                });
              })

              // determine relationships between cases & events
              .then((response) => {
                // there is nothing to retrieve ?
                if (
                  _.isEmpty(response.cases) &&
                  _.isEmpty(response.events)
                ) {
                  return response;
                }

                // all records for which we need to retrieve relationships
                const caseAndEventsRecordsIds = [
                  ...Object.keys(response.cases),
                  ...Object.keys(response.events)
                ];

                // to avoid issues with filter size because of the contactRecordsIds length make multiple requests to mongo
                // - retrieve deleted records too since we need to tell mobile that records were deleted
                // - also, 'persons.id' in is much faster than
                // $or: [{
                //   'persons.0.id': {
                //     $in: personsChunks[0]
                //   },
                //   'persons.1.id': {
                //     $in: personsChunks[1]
                //   }
                // }, {
                //   'persons.0.id': {
                //     $in: personsChunks[1]
                //   },
                //   'persons.1.id': {
                //     $in: personsChunks[0]
                //   }
                // }]
                // - so it is better to do an in and filter them here
                return new Promise((resolve, reject) => {
                  async.eachLimit(
                    _.chunk(
                      caseAndEventsRecordsIds,
                      noElementsInFilterArrayLimit
                    ),
                    5,
                    (personsChunks, asyncCallback) => {
                      dbConnection
                        .collection(dbSync.collectionsMap.relationship)
                        .find({
                          'persons.id': {
                            $in: personsChunks
                          }
                        }, {
                          projection: {
                            _id: 1,
                            persons: 1
                          }
                        })
                        .toArray()
                        .then((relationships) => {
                          // map relationship between cases & events
                          relationships.forEach((relationship) => {
                            // exclude relationships that aren't connected to persons included in our response
                            if (
                              !relationship.persons ||
                              relationship.persons.length !== 2 || (
                                !response.cases[relationship.persons[0].id] &&
                                !response.events[relationship.persons[0].id]
                              ) || (
                                !response.cases[relationship.persons[1].id] &&
                                !response.events[relationship.persons[1].id]
                              )
                            ) {
                              return;
                            }

                            // add to list
                            response.relationships[relationship._id] = true;
                          });

                          // finished
                          asyncCallback();
                        })
                        .catch(asyncCallback);
                    },
                    (err) => {
                      // an error occurred
                      if (err) {
                        return reject(err);
                      }

                      // finish with success
                      return resolve(response);
                    }
                  );
                });
              })

              // prepare person & relationship arrays of ids to be used later by filters
              .then((response) => {
                // make sure where is initialized
                filter.where = filter.where || {};

                // cases / contacts / events & relationships that we need to sync
                filter.where.contactsIds = Object.keys(response.contacts);
                filter.where.casesIds = Object.keys(response.cases);
                filter.where.eventsIds = Object.keys(response.events);
                filter.where.contactsOfContactsIds = Object.keys(response.contactsOfContacts);
                filter.where.relationshipsIds = Object.keys(response.relationships);

                // determine all persons that we need to retrieve
                filter.where.personsIds = [
                  ...filter.where.casesIds,
                  ...filter.where.contactsIds,
                  ...filter.where.eventsIds,
                  ...filter.where.contactsOfContactsIds
                ];
              })
              .catch(reject);
          }

          // run data gathering at first
          filterDataGathering
            .then(function () {
              // loop through all the collections and get the data
              async
                .series(
                  Object.keys(collections).map((collectionName) => {
                    return (callback) => {
                      let mongoDBFilter = {};
                      if (!options.noDataFiltering) {
                        // get mongoDB filter that will be sent; for some collections we might send additional filters
                        mongoDBFilter = dbSync.collectionsFilterMap[collectionName] ?
                          dbSync.collectionsFilterMap[collectionName](
                            collectionName,
                            customFilter,
                            filter
                          ) :
                          customFilter;
                      }
                      logger.debug(`Exporting collection: ${collectionName}`);

                      // export collection
                      exportCollectionInBatches(
                        dbConnection,
                        collections[collectionName],
                        collectionName,
                        mongoDBFilter,
                        options.chunkSize || 10000,
                        tmpDirName,
                        archivesDirName,
                        options,
                        callback
                      );
                    };
                  }),
                  (err) => {
                    // used to remove directory after archive si done or in case it fails
                    const cleanArchiveData = (dirToRemovePath) => {
                      // remove directory and its content
                      const cleanArchiveDataRecursive = (dirPath) => {
                        if (fs.existsSync(dirPath)) {
                          // fs.rmdirSync with "recursive: true" flag doesn't do the job properly...
                          fs.readdirSync(dirPath).forEach(function (fileOrDirToRemovePath) {
                            const currentPath = `${dirPath}${path.sep}${fileOrDirToRemovePath}`;
                            if (fs.lstatSync(currentPath).isDirectory()) {
                              // remove directory content
                              cleanArchiveDataRecursive(currentPath);
                            } else {
                              // delete file
                              fs.unlinkSync(currentPath);
                            }
                          });

                          // remove main directory
                          fs.rmdirSync(dirPath);
                        }
                      };

                      // delete archived directory
                      // no matter if it was a success or not
                      try {
                        cleanArchiveDataRecursive(dirToRemovePath);
                      } catch (remErr) {
                        // we don't have rights to delete directory or something has gone wrong...
                        // log data and continue as God intended to be..without any worries...
                        logger.error(`Failed removing tmp directories: ${remErr}`);
                      }
                    };

                    // an error occurred
                    if (err) {
                      // remove data
                      cleanArchiveData(tmpDirName);

                      // throw error
                      return reject(err);
                    }

                    // stop with error if there is no collection with data
                    if (!options.hasDataToExport) {
                      return reject({
                        code: 'NO-DATA'
                      });
                    }

                    // archive file name
                    let archiveName = `${tmp.tmpdir}/snapshot_${Moment().format('YYYY-MM-DD_HH-mm-ss')}_${uuid.v4()}.zip`;

                    // archive directory
                    createZipArchive(archivesDirName, archiveName, logger)
                      .then((data) => {
                        // remove data
                        cleanArchiveData(tmpDirName);

                        // finished
                        resolve(data);
                      })
                      .catch((err) => {
                        // remove data
                        cleanArchiveData(tmpDirName);

                        // finished
                        reject(err);
                      });
                  }
                );
            })
            .catch(reject);
        });
      });
  },

  /**
   * Extract and Decrypt Snapshot archive
   * @param snapshotFile
   * @param options
   * @returns {Promise<any>}
   */
  extractAndDecryptSnapshotArchive: function (snapshotFile, options) {
    // initialize mongodb connection
    return getMongoDBConnection()
      .then(function (dbConnection) {
        let tmpDirName, collectionFilesDirName;
        try {
          logger.debug('Creating tmp directories');
          // create a temporary directory to store the database files
          // it always created the folder in the system temporary directory
          const tmpDir = tmp.dirSync({
            prefix: options.prefix ?
              options.prefix :
              undefined,
            unsafeCleanup: true
          });
          tmpDirName = tmpDir.name;
          // also create an archives subdir
          collectionFilesDirName = `${tmpDirName}/collections`;
          fs.mkdirSync(collectionFilesDirName);
        } catch (err) {
          logger.error(`Failed creating tmp directories; ${err}`);
          return Promise.reject(err);
        }

        // handle restore log updates
        let restoreTotalSteps = 0;
        let processedNo = 0;
        const updateRestoreLog = (data) => {
          return options.restoreLogId ?
            dbConnection.collection('databaseActionLog').updateOne(
              {
                _id: options.restoreLogId
              }, {
                '$set': data
              }
            ) :
            Promise.resolve();
        };

        // update restore log if we have one
        logger.debug(`Extracting zip archive: ${snapshotFile}`);
        let collectionArchives;
        return updateRestoreLog({
          statusStep: 'LNG_STATUS_STEP_UNZIPPING',
          updatedAt: new Date(),
          dbUpdatedAt: new Date()
        })
          // unzip
          // IMPORTANT: used extractZip because adm-zip can extract only by loading entire zip file into memory which means that it can't unzip big zip files
          .then(() => extractZip(
            snapshotFile, {
              dir: tmpDirName
            }
          ))
          // decrypt all collection files archives if needed
          .then(() => {
            // get only zip files
            collectionArchives = fs.readdirSync(tmpDirName).filter(function (fileName) {
              return !fs.statSync(`${tmpDirName}/${fileName}`).isDirectory() && path.extname(fileName) === '.zip';
            });
          })
          .then(() => {
            // * 3 = 1 for decrypting, 1 for unzipping and 1 for restoring
            restoreTotalSteps = collectionArchives.length * 3;
            return updateRestoreLog({
              statusStep: 'LNG_STATUS_STEP_DECRYPTING',
              totalNo: restoreTotalSteps,
              processedNo: 0,
              updatedAt: new Date(),
              dbUpdatedAt: new Date()
            });
          })
          .then(() => {
            // define archive decryption action
            if (options.password) {
              // password provided, decrypt archives
              const decryptFunctions = collectionArchives.map(function (filePath) {
                return function (callback) {
                  workerRunner
                    .helpers
                    .decryptFile(options.password, {}, `${tmpDirName}/${filePath}`)
                    .then(() => {
                      processedNo++;
                      return updateRestoreLog({
                        processedNo,
                        updatedAt: new Date(),
                        dbUpdatedAt: new Date()
                      });
                    })
                    .then(() => {
                      callback();
                    })
                    .catch(callback);
                };
              });

              // start decrypting
              return new Promise(function (resolve, reject) {
                logger.debug(`Decrypting archives from: ${tmpDirName}`);
                async.parallelLimit(decryptFunctions, 10, function (err) {
                  // error ?
                  if (err) {
                    logger.error(`Failed to decrypt archive files from : ${tmpDirName}. ${err}`);
                    return reject(err);
                  }

                  // finished
                  return updateRestoreLog({
                    statusStep: 'LNG_STATUS_STEP_UNZIPPING_COLLECTIONS',
                    processedNo: collectionArchives.length,
                    updatedAt: new Date(),
                    dbUpdatedAt: new Date()
                  }).then(resolve).catch(reject);
                });
              });
            }

            // no decrypting necessary
            return updateRestoreLog({
              statusStep: 'LNG_STATUS_STEP_UNZIPPING_COLLECTIONS',
              processedNo: collectionArchives.length,
              updatedAt: new Date(),
              dbUpdatedAt: new Date()
            });
          })
          .then(() => {
            return new Promise(function (resolve, reject) {
              // unzip functions
              const unzipFunctions = collectionArchives.map(function (filePath) {
                return function (callback) {
                  extractZip(
                    `${tmpDirName}/${filePath}`, {
                      dir: collectionFilesDirName
                    }
                  ).then(() => {
                    // remove zip file
                    fs.unlinkSync(`${tmpDirName}/${filePath}`);
                  }).then(() => {
                    processedNo++;
                    return updateRestoreLog({
                      processedNo,
                      updatedAt: new Date(),
                      dbUpdatedAt: new Date()
                    });
                  }).then(() => {
                    callback();
                  }).catch(callback);
                };
              });

              // extract collection archives
              logger.debug(`Extracting archives from: ${tmpDirName}`);
              async.parallelLimit(unzipFunctions, 10, function (err) {
                // error ?
                if (err) {
                  logger.error(`Failed to extract collection archives at: ${tmpDirName}. ${err}`);
                  return reject(typeof err === 'string' ? {message: err} : err);
                }

                // finished
                return updateRestoreLog({
                  statusStep: 'LNG_STATUS_STEP_RESTORING',
                  processedNo: 2 * collectionArchives.length,
                  updatedAt: new Date(),
                  dbUpdatedAt: new Date()
                }).then(() => {
                  // collection files were decrypted and extracted; return collection files container directory
                  resolve({
                    collectionFilesDirName,
                    tmpDirName,
                    restoreTotalSteps
                  });
                }).catch(reject);
              });
            });
          });
      });
  }
};

process.on('message', function (message) {
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
});

