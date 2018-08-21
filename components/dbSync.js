'use strict';

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
  cluster: 'cluster'
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
        log('debug', `Record found (id: ${record.id}), updating record`);
        if (dbRecord.deleted) {
          record.deleted = true;
          // record was just deleted
        } else if (
          record.deleted !== undefined &&
          (
            record.deleted === true ||
            (typeof record.deleted === 'string' && record.deleted.toLowerCase() === 'true') ||
            record.deleted === 1
          )
        ) {
          // remove deleted markers
          delete record.deleted;
          delete record.deletedAt;
          // make sure the record is up to date
          return dbRecord
            .updateAttributes(record, options)
            .then(function (dbRecord) {
              // then destroy the record
              return dbRecord
                .destroy(record)
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
  syncRecord: syncRecord,
  syncRecordFlags: syncRecordFlags
};
