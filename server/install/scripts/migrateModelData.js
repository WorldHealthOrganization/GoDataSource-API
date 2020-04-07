'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const DataSources = require('../../datasources');
const Fs = require('fs-extra');
const Path = require('path');
const Async = require('async');
const Uuid = require('uuid');
const _ = require('lodash');

const migrationVersionsFoldersPath = Path.resolve(__dirname, './migrations');

const migrationLogStatusMap = {
  started: 'Started',
  success: 'Success',
  failed: 'Failed'
};

// initialize map of versions that contain migration scripts in migrations folder
// migration scripts will be executed in the order by version/script/action
const migrationVersions = [{
  version: '<2.35.0',
  scripts: [{
    fileName: 'lab-result.js',
    actions: [{
      name: 'labResultMigrate',
      buildNo: 1
    }, {
      name: 'labResultMigrate2',
      buildNo: 1
    }]
  }, {
    fileName: 'lab-result22.js',
    actions: [{
      name: 'labResultMigrate',
      buildNo: 1
    }, {
      name: 'labResultMigrate2',
      buildNo: 1
    }]
  }]
}, {
  version: '2.35.0',
  scripts: [{
    fileName: 'lab-result.js',
    actions: [{
      name: 'labResultMigrate',
      buildNo: 1
    }, {
      name: 'labResultMigrate2',
      buildNo: 1
    }]
  }]
}];

/**
 * Walk through the migrationVersions and get actions that need to be executed based on the last execution map
 * Will throw error if it was unable to read migration scripts from version folder or required actions are not defined in scripts
 * @param lastExecutionMap
 * @return {Array}
 */
const getActionsForExecutionMap = function (lastExecutionMap = {}) {
  let actionsForExecution = [];

  // loop through the versions
  migrationVersions.forEach(versionEntry => {
    // loop through the version scripts
    versionEntry.scripts.forEach(scriptEntry => {
      let script = require(Path.resolve(migrationVersionsFoldersPath, versionEntry.version, scriptEntry.fileName) + '/dsddd');

      // loop through the script actions
      scriptEntry.actions.forEach(actionEntry => {
        let actionPath = `${versionEntry.version}/${scriptEntry.fileName}/${actionEntry.name}`;
        let actionLastExecutedBuildNo = lastExecutionMap[actionPath];

        if (actionLastExecutedBuildNo !== actionEntry.buildNo) {
          // validate that action actually exists in script
          if (typeof script[actionEntry.name] !== 'function') {
            console.log(`Action ${actionPath} is not defined`);
          }

          // need to execute action
          actionsForExecution.push({
            name: actionPath,
            action: script[actionEntry.name],
            buildNo: actionEntry.buildNo
          });
        }
      });
    });
  });

  return actionsForExecution;
};

// script's entry point
const run = function (cb) {
  console.log('Starting model migration');

  // check versions to migrate
  if (!migrationVersions.length) {
    // nothing to migrate; continue
    console.log('No migrations need to be executed');
    return cb();
  }

  let mongoDBConnection, migrationLogCollection, migrationLogInstanceId, actionsToBeExecuted, executionMap = {};

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection({
      ignoreUndefined: DataSources.mongoDb.ignoreUndefined
    })
    .then(dbConn => {
      mongoDBConnection = dbConn;
      migrationLogCollection = dbConn.collection('migrationLog');

      // check migration log to see if there is already a migration in progress
      // Note: If the script is stopped when a migration is in progress that migration needs to be manually updated in DB as finished with status Failed
      return migrationLogCollection
        .findOne({
          status: migrationLogStatusMap.started
        }, {
          projection: {
            _id: 1
          }
        });
    })
    .then(inProgressMigration => {
      if (inProgressMigration) {
        return Promise.reject(`A migration is already in progress '${inProgressMigration._id}'. Cannot start a new migration until the current one is set as finished in DB`);
      }

      // there is no migration in progress; continue
      // find latest executed migration
      return migrationLogCollection
        .find({}, {
          limit: 1,
          sort: {
            endDate: -1
          },
          projection: {
            executionMap: 1
          }
        })
        .toArray();
    })
    .then(lastMigration => {
      try {
        actionsToBeExecuted = getActionsForExecutionMap(lastMigration.length && lastMigration[0].executionMap ? lastMigration[0].executionMap : {});
      } catch (e) {
        console.error('Failed reading migration actions', e);
        return Promise.reject(e);
      }

      if (!actionsToBeExecuted.length) {
        // nothing to migrate; continue
        console.log('No migrations need to be executed');
        // reject in order to skip next logic
        return Promise.reject();
      }

      // cache migration log instance ID
      migrationLogInstanceId = Uuid.v4();

      // start migration
      return migrationLogCollection
        .insert({
          _id: migrationLogInstanceId,
          status: migrationLogStatusMap.started,
          startDate: new Date()
        });
    })
    .then(() => {
      // create async actions for migration actions that need to be executed
      // all actions will be executed in series
      let migrationJobs = actionsToBeExecuted.map(actionEntry => {
        return (cb) => {
          console.log(`Started action '${actionEntry.name}'`);

          // execute actual migration action
          actionEntry.action((err) => {
            console.log(`Finished action '${actionEntry.name}'${err ? ` with error: ${err}` : ''}`);

            if (err) {
              return cb(`Error on action '${actionEntry.name}': ${err}`);
            }

            // action executed successfully; update execution map and migration log
            executionMap[actionEntry.name] = actionEntry.buildNo;
            return migrationLogCollection
              .updateOne({
                _id: migrationLogInstanceId
              }, {
                '$set': {
                  executionMap: executionMap
                }
              })
              .then(updateResult => {
                if (updateResult.modifiedCount === 0) {
                  // update wasn't actually made
                  return Promise.reject();
                }
              })
              .catch(err => {
                // don't stop on update migration log error
                console.warn(`Failed updating migration log '${migrationLogInstanceId}'. Error: ${err}`);
              })
              .then(() => {
                cb();
              });
          });
        };
      });

      return new Promise((resolve, reject) => {
        // execute migrations in series
        Async.series(migrationJobs, (err) => {
          if (err) {
            return reject(err);
          }

          return resolve();
        });
      });
    })
    .then(() => {
      // migration finished successfully
      // save migration log
      migrationLogCollection
        .updateOne({
          _id: migrationLogInstanceId
        }, {
          '$set': {
            status: migrationLogStatusMap.success,
            executionMap: executionMap,
            endDate: new Date()
          }
        })
        .then(updateResult => {
          if (updateResult.modifiedCount === 0) {
            return Promise.reject();
          }
        })
        .catch(err => {
          console.warn(`Failed updating migration log '${migrationLogInstanceId}' status. Need to manually update it for future migrations to work`, err);
          console.warn('Execution map: ', executionMap);
        })
        .then(() => {
          console.log('Finished model migration successfully');

          cb();
        });
    })
    .catch(err => {
      // we might reach catch even if there is no error; we used rejection in order to skip logic
      if (!err) {
        return cb();
      }

      // migration failed
      if (!migrationLogInstanceId) {
        // transaction failed before creating a new migration log instance
        console.error('Finished model migration with failure.', err);
        return cb(err);
      }

      // save migration log
      migrationLogCollection
        .updateOne({
          _id: migrationLogInstanceId
        }, {
          '$set': {
            status: migrationLogStatusMap.failed,
            executionMap: executionMap,
            endDate: new Date()
          }
        })
        .then(updateResult => {
          if (updateResult.modifiedCount === 0) {
            return Promise.reject();
          }
        })
        .catch(err => {
          console.warn(`Failed updating migration log '${migrationLogInstanceId}' status. Need to manually update it for future migrations to work`, err);
          console.warn('Execution map: ', executionMap);
        })
        .then(() => {
          console.error('Finished model migration with failure.', err);

          cb(err);
        });
    });
};

run((err) => {
  console.log('errr', err);
});

// execute model migration scripts
module.exports = run;
