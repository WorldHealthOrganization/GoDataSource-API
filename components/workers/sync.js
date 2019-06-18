'use strict';

const MongoClient = require('mongodb').MongoClient;
const async = require('async');
const tmp = require('tmp');
const archiver = require('archiver');
const fs = require('fs');
const Moment = require('moment');
const path = require('path');
const AdmZip = require('adm-zip');
const _ = require('lodash');

const logger = require('./../logger');
const dbSync = require('./../dbSync');
const workerRunner = require('./../workerRunner');
const dbConfig = require('./../../server/datasources').mongoDb;
const convertLoopbackFilterToMongo = require('../../components/convertLoopbackFilterToMongo');

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
  let mongoOptions = {};
  if (dbConfig.password) {
    mongoOptions = {
      auth: {
        user: dbConfig.user,
        password: dbConfig.password
      },
      authSource: dbConfig.authSource
    };
  }
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
function exportCollectionInBatches(dbConnection, mongoCollectionName, collectionName, filter, batchSize, tmpDirName, archivesDirName, options, callback) {
  /**
   * Get next batch from collection
   * @param skip
   */
  function getNextBatch(skip = 0) {
    let batchNumber = skip ? skip / batchSize : 0;

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
        if (!options.exportEmptyCollections) {
          // check if records were returned; consider collection finished if no records
          if (!records || !records.length) {
            logger.debug(`Collection '${collectionName}' export success.`);
            return callback();
          }
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
                  logger.debug(`Collection '${collectionName}' export success.`);
                  return callback();
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
  }

  // start collection export
  getNextBatch();
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
            logger.debug(`Failed creating tmp directories; ${err}`);
            return reject(err);
          }

          // parse from date filter
          let filter = options.filter;
          let customFilter = null;
          if (filter.where.hasOwnProperty('fromDate')) {
            // doing this because createdAt and updatedAt are equal when a record is created
            customFilter = {
              updatedAt: {
                $gte: new Date(filter.where.fromDate)
              }
            };
          }

          // flag that indicates if there is at least one collection with records
          // if this is not true, do not pack the main archive
          options.hasDataToExport = false;

          // define general records not deleted filter
          const notDeletedFilter = {
            deleted: {
              $ne: true
            }
          };

          // retrieve active cases and all their related contacts
          // a case is active if one of the following conditions matches:
          // - case.dateOfOnset is after or same as currentDate - outbreak.periodOfFollowup days
          // - case has at least one contact that is still under follow-up. A contact is under follow-up if all of the following conditions match:
          //    - contact.followUp.endDate is either empty or currentDate is between contact.followUp.startDate & contact.followUp.endDate
          //    - contact.followUp.status is either LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP or LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP
          //
          // =======> #TBD: what about cases that are inactive but have a relationship to a case that is active ?
          let filterDataGathering = Promise.resolve();
          filterDataGathering
            // retrieve outbreaks
            .then(() => {
              // retrieve all outbreaks that aren't deleted
              let outbreakFilter = notDeletedFilter;

              // should we retrieve information about all outbreaks or just some of them
              const outbreakIds = _.get(options, 'filter.where.outbreakId');
              if (!_.isEmpty(outbreakIds)) {
                outbreakFilter = {
                  $and: [
                    {
                      _id: convertLoopbackFilterToMongo(outbreakIds)
                    },
                    outbreakFilter
                  ]
                };
              }

              // retrieve outbreaks
              return dbConnection
                .collection(dbSync.collectionsMap.outbreak)
                .find(
                  outbreakFilter, {
                    projection: {
                      _id: 1,
                      periodOfFollowup: 1
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
              // retrieve all persons that aren't deleted
              let personFilter = notDeletedFilter;

              // retrieve only persons that belong to one of our outbreaks
              // if no outbreaks are provided, then it means that we have access to all outbreaks, so we need to retrieve all persons
              const outbreakIds = Object.keys(response.outbreaks);
              personFilter = {
                $and: [
                  {
                    outbreakId: {
                      $in: outbreakIds
                    }
                  },
                  personFilter
                ]
              };

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
                personFilter = {
                  $and: [
                    {
                      $or: [
                        {
                          addresses: {
                            $elemMatch: {
                              typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
                              locationId: {
                                $in: filter.where.locationsIds
                              }
                            }
                          }
                        }, {
                          'address.typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
                          'address.locationId': {
                            $in: filter.where.locationsIds
                          }
                        }
                      ]
                    },
                    personFilter
                  ]
                };
              }

              // retrieve outbreak persons
              // no need to retrieve them in bulk by bulk since we use projection which should reduce significantly the quantity of information retrieved from mongodb
              return dbConnection
                .collection(dbSync.collectionsMap.person)
                .find(
                  personFilter, {
                    projection: {
                      // common fields ( case / contact / event )
                      _id: 1,
                      outbreakId: 1,
                      type: 1,

                      // case fields
                      dateOfOnset: 1,

                      // contact fields
                      followUp: 1
                    }
                  }
                )
                .toArray()
                .then((personsRecords) => {
                  // loop through the personsIds to get contactIds / caseIds / eventIds
                  // & cache IDs on filter for future usage
                  // - contacts is an object because we need to easily find later a contact by id ( dictionary )
                  // - events is an object, because even if now we don't have duplicates, later we will add other event ids that could already be in the list of ids
                  //    - so this is an easy way to remove duplicates
                  response.cases = [];
                  response.contacts = {};
                  response.events = {};
                  personsRecords.forEach((person) => {
                    switch (person.type) {
                      case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT':
                        response.contacts[person._id] = person;
                        break;
                      case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE':
                        response.cases.push(person);
                        break;
                      case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT':
                        response.events[person._id] = true;
                        break;
                    }
                  });

                  // finished
                  return response;
                });
            })

            // retrieve case contacts relationships
            .then((response) => {
              // define object to perpetuate data to other promises
              response.relationships = [];

              // there is nothing to retrieve ?
              if (_.isEmpty(response.contacts)) {
                return response;
              }

              // retrieve case connected relationships of type contacts
              // since _ids are unique, there is no need to add outbreaks filter since we do that already for contacts, and here we retrieve only relationships for these contacts
              const contactRecordsIds = Object.keys(response.contacts);
              const relationshipFilters = {
                $and: [
                  {
                    'persons.id': {
                      $in: contactRecordsIds
                    }
                  },
                  notDeletedFilter
                ]
              };

              // retrieve case contacts relationships that aren't deleted
              return dbConnection
                .collection(dbSync.collectionsMap.relationship)
                .find(
                  relationshipFilters, {
                    projection: {
                      _id: 1,
                      persons: 1
                    }
                  }
                )
                .toArray()
                .then((relationships) => {
                  response.relationships = relationships;
                  return response;
                });
            })

            // map relationships
            .then((response) => {
              // map contacts to cases / events
              response.caseContactsMap = {};
              response.contactEventsMap = {};
              response.relationshipMap = {};
              response.relationships.forEach((relationship) => {
                // something went wrong, we have invalid data
                // jump over this record
                if (
                  !relationship.persons ||
                  relationship.persons.length !== 2
                ) {
                  return;
                }

                // if relation is between a case & a contact, the case will be the parent
                // otherwise, the contact will be the parent if related to an event
                let parentId, childId, mapData;
                if (
                  relationship.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ||
                  relationship.persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
                ) {
                  if (relationship.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                    mapData = response.caseContactsMap;
                    parentId = relationship.persons[1].id; // case
                    childId = relationship.persons[0].id; // contact
                  } else {
                    mapData = response.caseContactsMap;
                    parentId = relationship.persons[0].id; // case
                    childId = relationship.persons[1].id; // contact
                  }
                } else if (
                  relationship.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT' ||
                  relationship.persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                ) {
                  if (relationship.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                    mapData = response.contactEventsMap;
                    parentId = relationship.persons[0].id; // contact
                    childId = relationship.persons[1].id; // event
                  } else {
                    mapData = response.contactEventsMap;
                    parentId = relationship.persons[1].id; // contact
                    childId = relationship.persons[0].id; // event
                  }
                } else {
                  // contact to contact relationship
                  // we shouldn't have this kind of relationships
                  return;
                }

                // map case / event to contact
                _.set(
                  mapData,
                  `${parentId}.${childId}`,
                  true
                );

                // map relationships - Parent
                if (!response.relationshipMap[parentId]) {
                  response.relationshipMap[parentId] = [];
                }
                response.relationshipMap[parentId].push(relationship._id);

                // map relationships - Child
                if (!response.relationshipMap[childId]) {
                  response.relationshipMap[childId] = [];
                }
                response.relationshipMap[childId].push(relationship._id);
              });

              // finished
              return response;
            })

            // determine active cases
            .then((response) => {
              // determine active cases
              const endOfDay = Moment().endOf('day');
              response.activeCases = _.filter(
                response.cases,
                (caseData) => {
                  // retrieve case outbreak
                  const outbreak = response.outbreaks[caseData.outbreakId];

                  // make sure that the number of followup days has a valid value
                  let periodOfFollowup = outbreak.periodOfFollowup;
                  if (!_.isNumber(periodOfFollowup)) {
                    return false;
                  }

                  // case still active
                  // - case.dateOfOnset is after or same as currentDate - outbreak.periodOfFollowup days
                  if (
                    caseData.dateOfOnset &&
                    Moment(caseData.dateOfOnset).isSameOrAfter(Moment().add(-periodOfFollowup, 'days').startOf('day'))
                  ) {
                    return true;
                  }

                  // does this case have contacts ?
                  if (!response.caseContactsMap[caseData._id]) {
                    // this case has no contacts
                    return false;
                  }

                  // one of its contacts is still active ?
                  // - case has at least one contact that is still under follow-up. A contact is under follow-up if all of the following conditions match:
                  //    - contact.followUp.endDate is either empty or currentDate is between contact.followUp.startDate & contact.followUp.endDate
                  //    - contact.followUp.status is either LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP or LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP
                  let caseIsActive = false;
                  _.each(
                    response.caseContactsMap[caseData._id],
                    (nothing, contactId) => {
                      // check if contact is under follow-up
                      const contact = response.contacts[contactId];
                      if (
                        contact &&
                        contact.followUp && (
                          !contact.followUp.endDate || (
                            endOfDay.isBetween(
                              Moment(contact.followUp.startDate).startOf('day'),
                              Moment(contact.followUp.endDate).endOf('day'),
                              null,
                              '[]'
                            )
                          )
                        ) && (
                          !contact.followUp.status ||
                          [
                            'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP',
                            'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP'
                          ].indexOf(contact.followUp.status) > -1
                        )
                      ) {
                        // case is active, so there is no point in checking the other contacts
                        caseIsActive = true;
                        return false;
                      }
                    }
                  );

                  // case active / not active response
                  return caseIsActive;
                }
              );

              // finished
              return response;
            })

            // prepare person & relationship arrays of ids to be used later by filters
            .then((response) => {
              // make sure where is initialized
              filter.where = filter.where || {};

              // active cases
              const contactsIds = {};
              filter.where.casesIds = (response.activeCases || [])
                .map((caseData) => {
                  // go through all case contacts
                  if (response.caseContactsMap[caseData._id]) {
                    Object.assign(
                      contactsIds,
                      response.caseContactsMap[caseData._id]
                    );
                  }

                  // we need only the case id
                  return caseData._id;
                });

              // all contacts related to active cases
              filter.where.contactsIds = Object.keys(contactsIds);

              // determine events that should be retrieved
              // all matching search criteria + resulted from relationships with contacts
              filter.where.contactsIds.forEach((contactId) => {
                // do we have events associated with this contact ?
                if (response.contactEventsMap[contactId]) {
                  Object.assign(
                    response.events,
                    response.contactEventsMap[contactId]
                  );
                }
              });
              filter.where.eventsIds = Object.keys(response.events);

              // determine all persons that we need to retrieve
              filter.where.personsIds = [
                ...filter.where.casesIds,
                ...filter.where.contactsIds,
                ...filter.where.eventsIds
              ];

              // determine all relationships that we need to retrieve
              // IMPORTANT:
              // - only relationships between a contact & a case or a contact & an event are retrieved
              // - relationships between a case & an event, a case & a case or an event & an event aren't retrieved...
              filter.where.relationshipsIds = [];
              (filter.where.personsIds || []).forEach((personId) => {
                if (response.relationshipMap[personId]) {
                  filter.where.relationshipsIds.push(...response.relationshipMap[personId]);
                }
              });

              // make ids unique
              filter.where.relationshipsIds = [...new Set(filter.where.relationshipsIds)];
            })
            .catch(reject);

          // run data gathering at first
          filterDataGathering
            .then(function () {
              // loop through all the collections and get the data
              async
                .series(
                  Object.keys(collections).map((collectionName) => {
                    return (callback) => {
                      // get mongoDB filter that will be sent; for some collections we might send additional filters
                      let mongoDBFilter = dbSync.collectionsFilterMap[collectionName] ? dbSync.collectionsFilterMap[collectionName](collectionName, customFilter, filter) : customFilter;

                      logger.debug(`Exporting collection: ${collectionName}`);

                      // export collection
                      exportCollectionInBatches(dbConnection, collections[collectionName], collectionName, mongoDBFilter, options.chunkSize || 10000, tmpDirName, archivesDirName, options, callback);
                    };
                  }),
                  (err) => {
                    if (err) {
                      return reject(err);
                    }

                    // stop with error if there is no collection with data
                    if (!options.hasDataToExport) {
                      return reject({
                        code: 'NO-DATA'
                      });
                    }

                    // archive file name
                    let archiveName = `${tmpDirName}/../snapshot_${Moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;

                    createZipArchive(archivesDirName, archiveName, logger)
                      .then(resolve)
                      .catch(reject);
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
    return new Promise(function (resolve, reject) {
      let tmpDir, tmpDirName, collectionFilesDirName;

      try {
        logger.debug('Creating tmp directories');
        // create a temporary directory to store the database files
        // it always created the folder in the system temporary directory
        tmpDir = tmp.dirSync({unsafeCleanup: true});
        tmpDirName = tmpDir.name;
        // also create an archives subdir
        collectionFilesDirName = `${tmpDirName}/collections`;
        fs.mkdirSync(collectionFilesDirName);
      } catch (err) {
        logger.error(`Failed creating tmp directories; ${err}`);
        return reject(err);
      }

      // extract snapshot
      try {
        logger.debug(`Extracting zip archive: ${snapshotFile}`);
        let archive = new AdmZip(snapshotFile);
        archive.extractAllTo(tmpDirName);
      } catch (zipError) {
        logger.error(`Failed to extract zip archive: ${snapshotFile}. ${zipError}`);
        return reject(typeof zipError === 'string' ? {message: zipError} : zipError);
      }

      // decrypt all collection files archives if needed
      let collectionArchives;
      try {
        // get only zip files
        collectionArchives = fs.readdirSync(tmpDirName);
        collectionArchives = collectionArchives.filter(function (fileName) {
          return !fs.statSync(`${tmpDirName}/${fileName}`).isDirectory() && path.extname(fileName) === '.zip';
        });
      } catch (err) {
        logger.error(`Failed to read collection archive files at : ${tmpDirName}. ${err}`);
        return reject(err);
      }

      // define archive decryption action
      let decryptArchives;
      // if no password was provided
      if (!options.password) {
        // nothing to do, return file path as is
        decryptArchives = Promise.resolve(collectionArchives);
      } else {
        // password provided, decrypt archives
        let decryptFunctions = collectionArchives.map(function (filePath) {
          return function (callback) {
            workerRunner
              .helpers
              .decryptFile(options.password, {}, `${tmpDirName}/${filePath}`)
              .then(function () {
                callback();
              })
              .catch(callback);
          };
        });

        decryptArchives = new Promise(function (resolve, reject) {
          logger.debug(`Decripting archives from: ${tmpDirName}`);
          async.parallelLimit(decryptFunctions, 5, function (err) {
            if (err) {
              logger.error(`Failed to decrypt archive files from : ${tmpDirName}. ${err}`);
              return reject(err);
            }
            return resolve();
          });
        });
      }

      decryptArchives
        .then(function () {
          // extract collection archives
          try {
            logger.debug(`Extracting archives from: ${tmpDirName}`);
            collectionArchives.forEach(function (filePath) {
              let archive = new AdmZip(`${tmpDirName}/${filePath}`);
              archive.extractAllTo(collectionFilesDirName);
            });
          } catch (zipError) {
            logger.error(`Failed to extract collection archives at: ${tmpDirName}. ${zipError}`);
            return reject(typeof zipError === 'string' ? {message: zipError} : zipError);
          }
          // collection files were decrypted and extracted; return collection files container directory
          return resolve({
            collectionFilesDirName: collectionFilesDirName,
            tmpDirName: tmpDirName
          });
        })
        .catch(reject);
    });
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args)
    .then(function (result) {
      process.send([null, result]);
    })
    .catch(function (error) {
      process.send([error]);
    });
});

