'use strict';

const _ = require('lodash');
const helpers = require('./helpers');

// map of collections and their given corresponding collection name in database
const collectionsMap = {
  systemSettings: 'systemSettings',
  template: 'template',
  icon: 'icon',
  helpCategory: 'helpCategory',
  language: 'language',
  languageToken: 'languageToken',
  outbreak: 'outbreak',
  person: 'person',
  labResult: 'labResult',
  followUp: 'followUp',
  referenceData: 'referenceData',
  relationship: 'relationship',
  location: 'location',
  team: 'team',
  user: 'user',
  role: 'role',
  cluster: 'cluster',
  auditLog: 'auditLog'
};

// on sync we need get all collections except the following
let syncExcludeList = [
  'systemSettings',
  'team',
  'user',
  'role',
  'auditLog'
];
let syncCollections = Object.keys(collectionsMap).filter((collection) => syncExcludeList.indexOf(collection) === -1);

// create list of models that need to be synced starting from the syncCollections list
// add the case, contact and event models besides the existing ones
let syncModels = syncCollections.concat(['case', 'contact', 'event']);

/**
 * Add outbreakId filter if found to a mongoDB filter;
 * Note: the base mongoDB filter is not affected
 * @param collectionName Collection name; Depending on collection name the filter might be different
 * @param baseFilter MongoDB Base filter on which to add the outbreakId filter
 * @param filter Filter from request in which to check for outbreakId filter
 * @returns {*}
 */
function addOutbreakIdMongoFilter(collectionName, baseFilter, filter) {
  // check for outbreakId filter
  let outbreakIdFilter = _.get(filter, 'where.outbreakId');

  // initialize resulting filter
  // start from base filter; Note that it can be null
  let result = Object.assign({}, baseFilter || {});
  if (outbreakIdFilter) {
    // outbreak ID property is different in some models
    let outbreakIDDBProp = 'outbreakId';
    // update property name for outbreak model
    if (collectionName === 'outbreak') {
      outbreakIDDBProp = '_id';
    }

    // parse the outbreakIdFilter to mongoDB format
    if (typeof outbreakIdFilter === 'object') {
      // accepting only inq option for the filter
      if (outbreakIdFilter.inq) {
        result[outbreakIDDBProp] = {
          $in: outbreakIdFilter.inq
        };
      } else {
        // filter is not accepted; not using the outbreakId filter
      }
    } else {
      // filtering outbreakId by value
      result[outbreakIDDBProp] = outbreakIdFilter;
    }
  }

  return result;
}

/**
 * Filter record by outbreakId
 * @param collectionName Collection name; Depending on collection name the filter might be different
 * @param record Record; JSON model instance
 * @param outbreakIDs List of outbreak IDs for the outbreaks that can be imported
 * @returns {*}
 */
function isImportableRecord(collectionName, record, outbreakIDs) {
  // initialize importable flag
  let importable = true;

  // check for outbreakIDs
  if (outbreakIDs.length) {
    // get record outbreakId
    let recordOutbreakId = collectionName === 'outbreak' ? record._id : record.outbreakId;

    // check if the found outbreakId is accepted
    importable = outbreakIDs.indexOf(recordOutbreakId) !== -1;
  }

  return importable;
}

// on export some additional filters might be applied on different collections
// map collections to filter update functions
const collectionsFilterMap = {
  outbreak: addOutbreakIdMongoFilter,
  person: addOutbreakIdMongoFilter,
  labResult: addOutbreakIdMongoFilter,
  followUp: addOutbreakIdMongoFilter,
  relationship: addOutbreakIdMongoFilter,
  cluster: addOutbreakIdMongoFilter
};

// on import some additional filters might be applied on different collections
// map collections to functions that calculate if the record needs to be imported
const collectionsImportFilterMap = {
  outbreak: isImportableRecord,
  person: isImportableRecord,
  labResult: isImportableRecord,
  followUp: isImportableRecord,
  relationship: isImportableRecord,
  cluster: isImportableRecord
};

const syncRecordFlags = {
  UNTOUCHED: 'UNTOUCHED',
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  REMOVED: 'REMOVED'
};

/**
 * Sync a record of given model type with the main MongoDb database
 * Note: Deleted records are taken into consideration
 * Functionality description:
 * If no record is found or record is found and was created externally (no updateAt flag), create new record
 * If record has updateAt timestamp higher than the main database, update
 *
 * @param logger
 * @param model
 * @param record
 * @param [options]
 * @param [done]
 */
const syncRecord = function (logger, model, record, options, done) {

  // log formatted message
  function log(level, message) {
    logger[level](`dbSync::syncRecord ${model.modelName}: ${message}`);
  }

  // convert first level GeoPoints to valid Loopback GeoPoint on sync action
  // on sync the GeoPoint is received as it is saved in the DB (contains coordinates)
  // Loopback expects lat/lng instead of coordinates and breaks
  // we need to covert coordinates to lat/lng before trying to create/update
  function convertGeoPointToLoopbackFormat(record, model) {
    // get list of properties and check if there are any that would require parsing (geopoint properties)
    let modelProperties = model.definition.rawProperties;
    let geoPointProperties = Object.keys(modelProperties).filter(property => modelProperties[property].type === 'geopoint');

    // if model definition contains first level GeoPoints parse them
    if (geoPointProperties.length) {
      // convert each GeoPoint
      geoPointProperties.forEach(function (property) {
        // get current value and path
        let geoPoint = helpers.getReferencedValue(record, property);

        // always works with same data type (simplify logic)
        if (!Array.isArray(geoPoint)) {
          geoPoint = [geoPoint];
        }
        // go through each GeoPoint
        geoPoint.forEach(function (point) {
          // if the GeoPoint is not in the desired format
          if (
            point.value &&
            point.value.coordinates &&
            point.value.lng === undefined &&
            point.value.lat === undefined
          ) {
            // convert it
            _.set(record, point.exactPath, {
              lat: point.value.coordinates[1],
              lng: point.value.coordinates[0]
            });
          }
        });
      });
    }
  }

  // options is optional parameter
  if (typeof options === 'function') {
    done = options;
    options = {};
  }

  // mark this operation as a sync (if not specified otherwise)
  options._sync = options._sync !== undefined ? options._sync : true;

  let findRecord;
  // check if a record with the given id exists if record.id exists
  if (record.id !== undefined) {
    log('debug', `Trying to find record with id ${record.id}.`);
    findRecord = model
      .findOne({
        where: {
          id: record.id
        },
        deleted: true
      });
  } else {
    log('debug', 'Record id not present');
    // record id not present, don't search for a record
    findRecord = Promise.resolve();
  }

  const syncPromise = findRecord
    .then(function (dbRecord) {
      // record not found, create it
      if (!dbRecord) {
        // update geopoint properties
        convertGeoPointToLoopbackFormat(record, model);

        log('debug', `Record not found (id: ${record.id}), creating record.`);
        return model
          .create(record, options)
          .then(function (dbRecord) {
            return {
              record: dbRecord,
              flag: syncRecordFlags.CREATED
            };
          });
      }

      // if record was created from third parties, it might not have updated/created timestamps
      // in this case, just create a new record with new id
      if (!record.updatedAt) {
        // update geopoint properties
        convertGeoPointToLoopbackFormat(record, model);

        log('debug', `Record found (id: ${record.id}) but data received is missing updatedAt property, probably comes from external system, creating new record (with new id).`);
        delete record.id;
        return model
          .create(record, options)
          .then(function (dbRecord) {
            return {
              record: dbRecord,
              flag: syncRecordFlags.CREATED
            };
          });
      }

      // if updated timestamp is greater than the one in the main database, update
      // also make sure that if the record is soft deleted, it stays that way
      if (dbRecord.updatedAt.getTime() < new Date(record.updatedAt).getTime()) {
        // update geopoint properties
        convertGeoPointToLoopbackFormat(record, model);

        log('debug', `Record found (id: ${record.id}), updating record`);

        // record was just deleted
        if (
          !dbRecord.deleted &&
          record.deleted !== undefined &&
          (
            record.deleted === true ||
            (typeof record.deleted === 'string' && record.deleted.toLowerCase() === 'true') ||
            record.deleted === 1
          )
        ) {
          // remove deleted flag; keeping deletedAt property as we need to not change it when the model is destroyed
          delete record.deleted;
          // make sure the record is up to date
          return dbRecord
            .updateAttributes(record, options)
            .then(function (dbRecord) {
              // then destroy the record
              return dbRecord
                .destroy(options)
                .then(function () {
                  // get the record from the db to send it back
                  return model
                    .findOne({
                      where: {
                        id: record.id
                      },
                      deleted: true
                    })
                    .then(function (dbRecord) {
                      return {
                        record: dbRecord,
                        flag: syncRecordFlags.REMOVED
                      };
                    });
                });
            });
        }
        // record just needs to be updated
        return dbRecord
          .updateAttributes(record, options)
          .then(function (dbRecord) {
            return {
              record: dbRecord,
              flag: syncRecordFlags.UPDATED
            };
          });
      }

      log('debug', `Record found (id: ${record.id}) but data received is older than server data, record ignored.`);
      // if nothing happened, report that
      return {
        record: dbRecord,
        flag: syncRecordFlags.UNTOUCHED
      };
    });

  // allow working with callbacks
  if (typeof done === 'function') {
    syncPromise
      .then(function (result) {
        done(null, result);
      })
      .catch(done);
  } else {
    return syncPromise;
  }
};

module.exports = {
  collectionsMap: collectionsMap,
  collectionsFilterMap: collectionsFilterMap,
  collectionsImportFilterMap: collectionsImportFilterMap,
  syncRecord: syncRecord,
  syncRecordFlags: syncRecordFlags,
  syncCollections: syncCollections,
  syncModels: syncModels
};
