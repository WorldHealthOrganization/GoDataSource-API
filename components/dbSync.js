'use strict';

const _ = require('lodash');
const helpers = require('./helpers');
const fs = require('fs');
const path = require('path');
const async = require('async');
const fsExtra = require('fs-extra');
const workerRunner = require('./workerRunner');
const baseTransmissionChainModel = require('./baseModelOptions/transmissionChain');
const apiError = require('./apiError');
const bcrypt = require('bcrypt');
const Config = require('./../server/config.json');

const alternateUniqueIdentifierQueryOptions = Config.alternateUniqueIdentifierQueryOnImport || {};

// limit for each chunk
const noElementsInFilterArrayLimit = 20000;

// map of collection names and property name that matches a file on the disk
// also directory path (relative to the project) that holds the files should be left unchanged
const collectionsWithFiles = {
  icon: {
    prop: 'path',
    srcDir: 'server/storage/icons',
    targetDir: 'icons'
  },
  fileAttachment: {
    prop: 'path',
    srcDir: 'server/storage/files',
    targetDir: 'files'
  },
  transmissionChain: {
    prop: '_id',
    srcDir: baseTransmissionChainModel.storagePath,
    targetDir: 'cotFiles'
  }
};

// map of collections and their given corresponding collection name in database
const collectionsMap = {
  systemSettings: 'systemSettings',
  template: 'template',
  icon: 'icon',
  helpCategory: 'helpCategory',
  helpItem: 'helpItem',
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
  auditLog: 'auditLog',
  fileAttachment: 'fileAttachment',
  device: 'device',
  deviceHistory: 'deviceHistory',
  importMapping: 'importMapping',
  filterMapping: 'filterMapping',
  migrationLog: 'migrationLog',
  transmissionChain: 'transmissionChain'
};

// list of user related collections
const userCollections = ['team', 'user', 'role'];

// map of export type to collections
const collectionsForExportTypeMap = {
  system: ['template', 'icon', 'helpCategory', 'helpItem', 'language', 'languageToken', 'referenceData', 'location']
};
collectionsForExportTypeMap.outbreak = collectionsForExportTypeMap.system.concat(['outbreak']);
collectionsForExportTypeMap.full = collectionsForExportTypeMap.outbreak.concat([
  'person',
  'labResult',
  'followUp',
  'relationship',
  'cluster',
  'fileAttachment',
  'importMapping'
]);
collectionsForExportTypeMap.mobile = collectionsForExportTypeMap.full.concat(userCollections);
// mobile export doesn't need to include template, icon, helpCategory, helpItem, fileAttachment
['template', 'icon', 'fileAttachment'].forEach(function (model) {
  collectionsForExportTypeMap.mobile.splice(collectionsForExportTypeMap.mobile.indexOf(model), 1);
});

// on sync we need get all collections except the following
let syncExcludeList = [
  'systemSettings',
  'role',
  'auditLog',
  'helpCategory',
  'helpItem',
  'device',
  'deviceHistory'
];
let syncCollections = Object.keys(collectionsMap).filter((collection) => syncExcludeList.indexOf(collection) === -1);

// create list of models that need to be synced starting from the syncCollections list
// add the case, contact and event models besides the existing ones
let syncModels = syncCollections.concat(['case', 'contact', 'event', 'contactOfContact']);

// on import sync package we need to sync in series some collections that generate values based on resources in DB
// eg: person model - visualId
const collectionsToSyncInSeries = ['person'];

// for which records we should always retrieve only NOT deleted records?
const collectionsExcludeDeletedRecords = {
  languageToken: true
};

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
 * Split in condition into multiple filters since having too many ids in a $in condition fails to retrieve data
 */
function getChunkFilters(
  collectionName,
  baseFilter,
  filter,
  resultKey,
  recordsIds
) {
  // initiate filters
  const filters = [];

  // check if we need to filter for specific records
  if (recordsIds) {
    // split into chunks since we can't send as many ids as we want
    _.chunk(
      recordsIds,
      noElementsInFilterArrayLimit
    ).forEach((chunkIds) => {
      // construct filter
      const result = addOutbreakIdMongoFilter(
        collectionName,
        baseFilter,
        filter
      );

      // add chunk condition
      result[resultKey] = {
        '$in': chunkIds
      };

      // push filter
      filters.push(result);
    });
  } else {
    // original filter that we don't need to alter
    filters.push(
      addOutbreakIdMongoFilter(
        collectionName,
        baseFilter,
        filter
      )
    );
  }

  // array of filters since we might need to make multiple requests due to large amounts of ids
  return filters;
}

/**
 * Add outbreak ID and person ID filter if found to a mongoDB filter;
 * Note: the base mongoDB filter is not affected
 * @param collectionName Collection name; Depending on collection name the filter might be different
 * @param baseFilter MongoDB Base filter on which to add the person ID filter
 * @param filter Filter from request in which to check for personsIds filter
 * @returns {*}
 */
function addPersonMongoFilter(collectionName, baseFilter, filter) {
  return getChunkFilters(
    collectionName,
    baseFilter,
    filter,
    '_id',
    _.get(filter, 'where.personsIds')
  );
}

/**
 * Add outbreak ID and case ID filter if found to a mongoDB filter;
 * Note: the base mongoDB filter is not affected
 * @param collectionName Collection name; Depending on collection name the filter might be different
 * @param baseFilter MongoDB Base filter on which to add the case ID filter
 * @param filter Filter from request in which to check for casesIds filter
 * @returns {*}
 */
function addLabResultMongoFilter(collectionName, baseFilter, filter) {
  // merge case ids with contact ids
  const caseIds = _.get(filter, 'where.casesIds');
  const contactIds = _.get(filter, 'where.contactsIds');
  const caseAndContactIds = [];

  // case ids
  if (
    caseIds &&
    Array.isArray(caseIds)
  ) {
    caseAndContactIds.push(...caseIds);
  }

  // contact ids
  if (
    contactIds &&
    Array.isArray(contactIds)
  ) {
    caseAndContactIds.push(...contactIds);
  }

  // get chunks
  return getChunkFilters(
    collectionName,
    baseFilter,
    filter,
    'personId',
    caseIds || contactIds ?
      caseAndContactIds :
      caseIds
  );
}

/**
 * Add outbreak ID and contact ID/case ID + team ID filter if found to a mongoDB filter;
 * Note: the base mongoDB filter is not affected
 * Note: also getting followups of cases as there might be some that were converted from contacts and they might have had followups
 * @param collectionName Collection name; Depending on collection name the filter might be different
 * @param baseFilter MongoDB Base filter on which to add the contacts ID/cases ID and team ID filter
 * @param filter Filter from request in which to check for contactsIds, casesIds and teamsIDs filters; Both must be present
 * @returns {*}
 */
function addFollowupMongoFilter(collectionName, baseFilter, filter) {
  const filters = getChunkFilters(
    collectionName,
    baseFilter,
    filter,
    'personId',
    _.get(filter, 'where.contactsIds', []).concat(_.get(filter, 'where.casesIds', []))
  );

  // attach teams to filters
  let teamsIDs = _.get(filter, 'where.teamsIds');
  if (teamsIDs) {
    filters.forEach((filter) => {
      filter.$or = [{
        teamId: {
          '$in': teamsIDs
        }
      }, {
        teamId: null
      }];
    });
  }

  // finished
  return filters;
}

/**
 * Add outbreak ID and relationship ID filter if found to a mongoDB filter;
 * Note: the base mongoDB filter is not affected
 * @param collectionName Collection name; Depending on collection name the filter might be different
 * @param baseFilter MongoDB Base filter on which to add the relationship ID filter
 * @param filter Filter from request in which to check for relationshipsIds filter
 * @returns {*}
 */
function addRelationshipMongoFilter(collectionName, baseFilter, filter) {
  return getChunkFilters(
    collectionName,
    baseFilter,
    filter,
    '_id',
    _.get(filter, 'where.relationshipsIds')
  );
}

/**
 * Add language token filter if found to a mongoDB filter;
 * Note: the base mongoDB filter is not affected
 * @param collectionName Collection name; Currently not used however the function is automatically called with this param
 * @param baseFilter MongoDB Base filter on which to add the language token filter
 * @param filter Filter from request in which to check for language token filter
 * @returns {*}
 */
function addLanguageTokenMongoFilter(collectionName, baseFilter, filter) {
  // initialize resulting filter
  // start from base filter; Note that it can be null
  let result = Object.assign({}, baseFilter || {});

  // check for language token filter
  let languageTokenFilter = _.get(filter, 'where.languageTokens');

  // check for languages filter
  let languagesFilter = _.get(filter, 'where.languages');

  // update filter only if languagesFilter is an array
  if (Array.isArray(languagesFilter)) {
    // construct languages filter
    const languagesMongoFilter = {
      languageId: {
        $in: languagesFilter
      }
    };

    // update result filter
    if (_.isEmpty(result)) {
      result = languagesMongoFilter;
    } else {
      result = {
        '$and': [
          result,
          languagesMongoFilter
        ]
      };
    }
  }

  // update filter only if languageTokenFilter is an array
  if (Array.isArray(languageTokenFilter)) {
    // Note: should be in sync with the subTemplates names from templateParser.js
    const subTemplates = ['caseInvestigationTemplate', 'contactInvestigationTemplate', 'contactFollowUpTemplate', 'labResultsTemplate'];

    // create language token mongo filter; creating it as an '$or' filter
    let languageTokenMongoFilter = {
      '$or': [
        {
          // get required tokens
          'token': {
            '$in': languageTokenFilter
          }
        },
        {
          // get all reference data and templates/questionnaires tokens
          'token': {
            '$regex': `${subTemplates.reduce(
              function (result, subTemplateName) {
                result += '|' + subTemplateName.toUpperCase();
                return result;
              },
              // start the regex with reference data identifier
              'LNG_REFERENCE_DATA')}`
          }
        }
      ]
    };

    // update result filter
    if (_.isEmpty(result)) {
      result = languageTokenMongoFilter;
    } else {
      result = {
        '$and': [
          result,
          languageTokenMongoFilter
        ]
      };
    }
  }

  // finished
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

/**
 * Alter user information that is added to snapshot for upstream server
 * User data shouldn't contain actual roles and password
 * @param {Array} records - List of user records
 */
function alterUserData(records) {
  records.forEach(record => {
    // no roles
    record.roleIds = [''];
    // random password
    record.password = bcrypt.hashSync(helpers.randomString('all', 20, 30), 10);
  });
}

// on export some additional filters might be applied on different collections
// map collections to filter update functions
const collectionsFilterMap = {
  outbreak: addOutbreakIdMongoFilter,
  person: addPersonMongoFilter,
  labResult: addLabResultMongoFilter,
  followUp: addFollowupMongoFilter,
  relationship: addRelationshipMongoFilter,
  cluster: addOutbreakIdMongoFilter,
  fileAttachment: addOutbreakIdMongoFilter,
  languageToken: addLanguageTokenMongoFilter
};

// on import some additional filters might be applied on different collections
// map collections to functions that calculate if the record needs to be imported
const collectionsImportFilterMap = {
  outbreak: isImportableRecord,
  person: isImportableRecord,
  labResult: isImportableRecord,
  followUp: isImportableRecord,
  relationship: isImportableRecord,
  cluster: isImportableRecord,
  fileAttachment: isImportableRecord
};

// on export for upstream servers some information needs to be altered
// map collections to functions that alter data
const collectionsAlterDataMap = {
  user: alterUserData
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
 * @param app
 * @param model
 * @param record
 * @param [options]
 * @param [done]
 */
const syncRecord = function (app, model, record, options, done) {
  // log formatted message
  function log(level, message) {
    app.logger[level](`dbSync::syncRecord ${model.modelName}: ${message}`);
  }

  // on sync, use person model to find converted persons
  const usePersonModel = options._sync && (
    model.modelName === app.models.case.modelName ||
    model.modelName === app.models.contact.modelName ||
    model.modelName === app.models.contactOfContact.modelName
  );

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

  // merge merge properties so we don't remove anything from a array / properties defined as being "mergeble" in case we don't send the entire data
  // this is relevant only when we update a record since on create we don't have old data that we need to merge
  const mergeMissingDataFromMergebleFields = (record, model, dbRecord) => {
    // no merge fields ?
    if (
      !record ||
      !model ||
      !model.mergeFieldsOnUpdate ||
      !dbRecord
    ) {
      return;
    }

    // merge data
    model.mergeFieldsOnUpdate.forEach((mergeField) => {
      // not a merge field ?
      // OR not need to merge data since we don't try to update it ?
      if (
        !record[mergeField] ||
        !dbRecord[mergeField]
      ) {
        return;
      }

      // merge properties recursively
      const mergeRecursive = (
        destination,
        source,
        property
      ) => {
        if (!destination.hasOwnProperty(property)) {
          destination[property] = source[property];
        } else {
          // if array or object we need to look further
          if (
            _.isArray(source[property]) ||
            _.isObject(source[property])
          ) {
            // go through array / object and merge each value
            _.each(source[property], (value, key) => {
              mergeRecursive(
                destination[property],
                source[property],
                key
              );
            });
          } else {
            // we need to keep the destination value, so no need to do any changes here
            // NOTHING TO DO
          }
        }
      };

      // if we try to update a specific property then we need to make sure all missing values are merged
      Object.keys(dbRecord[mergeField]).forEach((mergeFieldProp) => {
        mergeRecursive(
          record[mergeField],
          dbRecord[mergeField],
          mergeFieldProp
        );
      });
    });
  };

  // options is optional parameter
  if (typeof options === 'function') {
    done = options;
    options = {};
  }

  // mark this operation as a sync (if not specified otherwise)
  options._sync = options._sync !== undefined ? options._sync : true;

  // go through date type fields and convert them to a proper date
  if (!_.isEmpty(model._parsedDateProperties)) {
    (function setDateProps(obj, map) {
      // go through each date properties and parse date properties
      for (let prop in map) {
        // skip createdAt, updatedAt properties from formatting
        // but make sure they are valid dates before trying to import them into database
        // because we might have cases where those values were altered outside of the system
        if (['createdAt', 'updatedAt', 'dbUpdatedAt', 'deletedAt'].indexOf(prop) !== -1) {
          let propValue = _.get(obj, prop);
          // XML file don't have 'null' values, they use empty strings instead
          if (propValue === '') {
            propValue = null;
            _.set(obj, prop, propValue);
          }
          if (propValue) {
            const convertedDate = helpers.getDate(propValue);
            if (!convertedDate.isValid()) {
              _.set(obj, prop, null);
            }
          }
          continue;
        }

        if (map.hasOwnProperty(prop)) {
          // this is an array prop
          if (typeof map[prop] === 'object') {
            if (Array.isArray(obj[prop])) {
              obj[prop].forEach((item) => setDateProps(item, map[prop]));
            }
          } else {
            let recordPropValue = _.get(obj, prop);
            // XML file don't have 'null' values, they use empty strings instead
            if (recordPropValue === '') {
              recordPropValue = null;
              _.set(obj, prop, recordPropValue);
            }
            if (recordPropValue) {
              // try to convert the string value to date, if valid, replace the old value
              let convertedDate = helpers.getDate(recordPropValue);
              if (convertedDate.isValid()) {
                _.set(obj, prop, convertedDate.toDate());
              }
            }
          }
        }
      }
    })(record, model._parsedDateProperties);
  }

  let findRecord = Promise.resolve();
  let alternateQueryForRecord;

  // check if a record with the given id exists if record.id exists
  if (
    record.id !== undefined &&
    record.id !== null &&
    record.id !== ''
  ) {
    log('debug', `Trying to find record with id ${record.id}.`);
    if (usePersonModel) {
      findRecord = app.models.person
        .rawFind({
          id: record.id
        }, {
          projection: {
            id: 1,
            type: 1
          },
          includeDeletedRecords: 1,
          limit: 1
        })
        .then(function (results) {
          // check if the person was converted
          if (
            results &&
            results.length
          ) {
            // set the new model ?
            const personModel = app.models[app.models.person.typeToModelMap[results[0].type]];
            if (model.modelName !== personModel.modelName) {
              model = personModel;
            }
          }
        });
    }

    // get the record
    findRecord = findRecord.then(() => model
      .findOne({
        where: {
          id: record.id
        },
        deleted: true
      })
    );
  }
  // some models might query for different unique identifiers when id is not present
  else if (
    alternateUniqueIdentifierQueryOptions[model.modelName] &&
    model.getAlternateUniqueIdentifierQueryForSync &&
    (alternateQueryForRecord = model.getAlternateUniqueIdentifierQueryForSync(record)) !== null
  ) {
    const stringifiedAlternateQuery = JSON.stringify(alternateQueryForRecord);
    log('debug', `Trying to find record with alternate unique identifier ${stringifiedAlternateQuery}.`);
    if (usePersonModel) {
      findRecord = app.models.person
        .rawFind(
          alternateQueryForRecord, {
            projection: {
              id: 1,
              type: 1
            },
            includeDeletedRecords: 1,
            limit: 2
          })
        .then(function (results) {
          if (!results || !results.length) {
            // no db record was found; continue with creating the record
            return null;
          } else if (results.length > 1) {
            // more than one result found; we cannot know which one we should update
            return Promise.reject(apiError.getError('DUPLICATE_ALTERNATE_UNIQUE_IDENTIFIER', {
              alternateIdQuery: stringifiedAlternateQuery
            }));
          }

          // check if the person was converted
          const personModel = app.models[app.models.person.typeToModelMap[results[0].type]];
          // set the new model ?
          if (model.modelName !== personModel.modelName) {
            model = personModel;
          }

          // get the record again to not change the workflow
          return model
            .find({
              where: {
                _id: results[0].id
              },
              limit: 1,
              deleted: true
            });
        });
    } else {
      findRecord = model
        .find({
          where: alternateQueryForRecord,
          limit: 2,
          deleted: true
        });
    }
    findRecord.then(results => {
      if (!results || !results.length) {
        // no db record was found; continue with creating the record
        return null;
      } else if (results.length > 1) {
        // more than one result found; we cannot know which one we should update
        return Promise.reject(apiError.getError('DUPLICATE_ALTERNATE_UNIQUE_IDENTIFIER', {
          alternateIdQuery: stringifiedAlternateQuery
        }));
      }

      // single record found; continue with it and try to update it
      return results[0];
    });
  } else {
    log('debug', 'Record id not present');
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

      // db record was found
      // if we are in a sync action from another Go.Data instance and the model is user or team don't try to do any updates
      if (
        options.snapshotFromClient &&
        ['team', 'user'].includes(model.name)
      ) {
        log('debug', `Record found (id: ${record.id}) but it is a ${model.name} in a sync from a client instance. Skipped record`);
        return Promise.resolve({
          record: dbRecord,
          flag: syncRecordFlags.UNTOUCHED
        });
      }

      // if record was found in DB but we cannot figure out if the changes are newer or older skip record (updatedAt is missing)
      if (!record.updatedAt) {
        log('debug', `Record found (id: ${record.id}) but data received is missing updatedAt property. Skipped record`);
        return Promise.reject({message: `Record found (id: ${record.id}) but data received is missing updatedAt property. Skipped record`});
      }

      // if updated timestamp is greater than the one in the main database, update
      // also make sure that if the record is soft deleted, it stays that way
      if (new Date(dbRecord.updatedAt).getTime() < new Date(record.updatedAt).getTime()) {
        // update geopoint properties
        convertGeoPointToLoopbackFormat(record, model);

        // merge merge properties so we don't remove anything from a array / properties defined as being "mergeble" in case we don't send the entire data
        // this is relevant only when we update a record since on create we don't have old data that we need to merge
        mergeMissingDataFromMergebleFields(record, model, dbRecord);

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

        // if we restore record make sure we remove deleted date too
        if (
          dbRecord.deleted &&
          record.deleted !== undefined &&
          (
            record.deleted === false ||
            (typeof record.deleted === 'string' && record.deleted.toLowerCase() === 'false') ||
            record.deleted === 0
          )
        ) {
          // update deletedAt
          if (dbRecord.deletedAt) {
            record.deletedAt = null;
          }

          // update deletedByParent
          if (dbRecord.deletedByParent) {
            record.deletedByParent = null;
          }
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
    })
    // catch errors and handle some specific ones
    .catch(err => {
      if (!(typeof err === 'object')) {
        return Promise.reject(err);
      }

      let formattedError;
      switch (err.code) {
        // MongoError for longitude/latitude out of bounds
        case 16755:
          formattedError = apiError.getError('INVALID_ADDRESS_LATITUDE_LONGITUDE');
          break;
        // Loopback error; check for invalid lat/lng
        case 'ERR_ASSERTION':
          if (
            err.message &&
            (
              err.message.includes('lat must be') ||
              err.message.includes('lng must be')
            )
          ) {
            // MongoError for longitude/latitude out of bounds
            formattedError = apiError.getError('INVALID_ADDRESS_LATITUDE_LONGITUDE');
          }
          break;
        default:
          break;
      }

      // not handled error
      !formattedError && (formattedError = err);
      return Promise.reject(formattedError);
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

/**
 * Include files that are related to records in the target collection into the temporary directory
 * @param collectionName
 * @param records
 * @param tmpDir
 * @param logger
 * @param password Encrypt password
 * @param done
 */
const exportCollectionRelatedFiles = function (collectionName, records, tmpDir, logger, password, done) {
  // if there are no records, do not run anything
  if (!records.length) {
    return done();
  }

  // if collection has no related files configuration set up, stop
  if (!collectionsWithFiles.hasOwnProperty(collectionName)) {
    return done();
  }

  let storageModel = {};
  // cot file are not saved using storage model
  if (collectionName !== 'transmissionChain') {
    require('./../server/models/storage')(storageModel);
  }

  // get the configuration options
  const collectionOpts = collectionsWithFiles[collectionName];

  // create the temporary directory matching the configured path
  return fs.mkdir(path.join(tmpDir, collectionOpts.targetDir), {recursive: true}, (err) => {
    if (err) {
      return done(err);
    }

    return async.parallelLimit(
      records.map((record) => {
        return function (doneRecord) {
          let filePath;
          // cot files path might not be relative so we cannot calculate it using storage model
          if (collectionName === 'transmissionChain') {
            filePath = baseTransmissionChainModel.helpers.getFilePath(record[collectionOpts.prop]);
          } else {
            filePath = storageModel.resolvePath(record[collectionOpts.prop]);
          }

          // make sure the source file is okay
          return fs.lstat(filePath, function (err) {
            if (err) {
              logger.warn(`Failed to export file: ${filePath}. Related record: ${record._id}.`, err);
              return doneRecord();
            }

            // copy file in temporary directory
            let tmpFilePath = path.join(
              tmpDir,
              collectionOpts.targetDir,
              collectionName === 'transmissionChain' ?
                baseTransmissionChainModel.helpers.getFileName(record[collectionOpts.prop]) :
                path.basename(record[collectionOpts.prop])
            );

            return fs.copyFile(
              filePath,
              tmpFilePath,
              function () {
                if (!password) {
                  return doneRecord();
                }

                // password is sent; encrypt file
                return workerRunner
                  .helpers
                  .encryptFile(password, {}, tmpFilePath)
                  .then(function () {
                    logger.debug(`Encrypted file: ${tmpFilePath}. Related record: ${record._id}.`);
                    doneRecord();
                  })
                  .catch(function (err) {
                    logger.warn(`Failed to encrypt file: ${tmpFilePath}. Related record: ${record._id}.`, err);
                    doneRecord();
                  });
              }
            );
          });
        };
      }),
      // restrict maximum parallel runs, to be consistent with other usages
      10,
      done
    );
  });
};

/**
 * Import related files from temporary directory to local storage
 * @param collectionName
 * @param tmpDir
 * @param logger
 * @param password
 * @param done
 */
const importCollectionRelatedFiles = function (collectionName, tmpDir, logger, password, done) {
  // if collection has no related files, stop
  if (!collectionsWithFiles.hasOwnProperty(collectionName)) {
    return done();
  }

  // get the property, directory names from the mapping
  const collectionOpts = collectionsWithFiles[collectionName];

  let collectionFilesTmpDir = path.join(tmpDir, collectionOpts.targetDir);
  let collectionFilesDir = path.isAbsolute(collectionOpts.srcDir) ? collectionOpts.srcDir : path.join(__dirname, '..', collectionOpts.srcDir);

  // anything to do ?
  if (!fs.existsSync(collectionFilesTmpDir)) {
    done();
    return;
  }

  logger.debug(`Importing related files for collection '${collectionName}'`);

  /**
   * Copy files from tmp dir to target dir
   */
  function copyFiles() {
    fsExtra.copy(
      collectionFilesTmpDir,
      collectionFilesDir,
      function (err) {
        if (err) {
          logger.warn(`Failed to copy files from tmp dir '${collectionFilesTmpDir}' to '${collectionFilesDir}'`);
          return done(err);
        }

        return done();
      }
    );
  }

  // check if the files need to be decrypted
  if (!password) {
    return copyFiles();
  }

  // decrypt files
  // read all files in the temp dir
  return fs.readdir(collectionFilesTmpDir, (err, filenames) => {
    if (err) {
      logger.warn(`Failed to read files from tmp dir '${collectionFilesTmpDir}'.`);
      return done(err);
    }

    logger.debug(`Decrypting files at '${collectionFilesTmpDir}'`);

    return async.parallelLimit(
      filenames.map((fileName) => (doneFile) => {
        let filePath = `${collectionFilesTmpDir}/${fileName}`;

        // decrypt file
        workerRunner
          .helpers
          .decryptFile(password, {}, filePath)
          .then(function () {
            doneFile();
          })
          .catch(function (err) {
            logger.warn(`Failed to decrypt file '${filePath}'. Error: ${err}. Removing file.`);

            // remove file; waiting for remove action to finish to not copy encrypted files to target dir
            fs.unlink(filePath, function (err) {
              logger.warn(`Failed to remove file '${filePath}'. Error: ${err}.`);
              doneFile();
            });
          });
      }),
      10,
      function () {
        // decrypt finished; copy files to target dir
        return copyFiles();
      });
  });
};

module.exports = {
  collectionsMap: collectionsMap,
  collectionsFilterMap: collectionsFilterMap,
  collectionsImportFilterMap: collectionsImportFilterMap,
  collectionsToSyncInSeries: collectionsToSyncInSeries,
  collectionsExcludeDeletedRecords: collectionsExcludeDeletedRecords,
  collectionsAlterDataMap: collectionsAlterDataMap,
  syncRecord: syncRecord,
  syncRecordFlags: syncRecordFlags,
  syncCollections: syncCollections,
  collectionsForExportTypeMap: collectionsForExportTypeMap,
  userCollections: userCollections,
  syncModels: syncModels,
  collectionsWithFiles: collectionsWithFiles,
  exportCollectionRelatedFiles: exportCollectionRelatedFiles,
  importCollectionRelatedFiles: importCollectionRelatedFiles
};
