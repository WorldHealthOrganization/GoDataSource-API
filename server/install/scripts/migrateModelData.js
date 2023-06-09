'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const DataSources = require('../../datasources');
const Path = require('path');
const Async = require('async');
const Uuid = require('uuid');

const migrationVersionsFoldersPath = Path.resolve(__dirname, './migrations');

const migrationLogStatusMap = {
  started: 'Started',
  success: 'Success',
  failed: 'Failed'
};

// initialize map of versions that contain migration scripts in migrations folder
// migration scripts will be executed in the order by version/script/action
const migrationVersions = [{
  version: 'older',
  scripts: [{
    fileName: 'defaultLanguages.js',
    actions: [{
      name: 'run',
      buildNo: 30
    }]
  }, {
    fileName: 'defaultReferenceData.js',
    actions: [{
      name: 'run',
      buildNo: 3
    }]
  }, {
    fileName: 'defaultHelpData.js',
    actions: [{
      name: 'run',
      buildNo: 1
    }]
  }, {
    fileName: 'defaultOutbreakTemplateData.js',
    actions: [{
      name: 'run',
      buildNo: 3
    }]
  }, {
    fileName: 'case.js',
    actions: [{
      name: 'migrateCases',
      buildNo: 1
    }]
  }, {
    fileName: 'followUp.js',
    actions: [{
      name: 'migrateFollowUps',
      buildNo: 1
    }]
  }, {
    fileName: 'labResult.js',
    actions: [{
      name: 'migrateLabResults',
      buildNo: 1
    }]
  }, {
    fileName: 'systemSettings.js',
    actions: [{
      name: 'migrateSystemSettings',
      buildNo: 1
    }]
  }, {
    fileName: 'user.js',
    actions: [{
      name: 'migrateUsers',
      buildNo: 1
    }]
  }, {
    fileName: 'migrateRolesAndUsers.js',
    actions: [{
      name: 'run',
      buildNo: 2
    }]
  }, {
    fileName: 'populateMissingLanguageTokens.js',
    actions: [{
      name: 'run',
      buildNo: 1
    }]
  }, {
    fileName: 'migrateCaseCentreName.js',
    actions: [{
      name: 'run',
      buildNo: 1
    }]
  }]
}, {
  version: '2.35.0',
  scripts: [{
    fileName: 'person.js',
    actions: [{
      name: 'setRelationshipsInformationOnPerson',
      buildNo: 3
    }, {
      name: 'setUsualPlaceOfResidenceLocationIdOnPerson',
      buildNo: 1
    }]
  }, {
    fileName: 'languageToken.js',
    actions: [{
      name: 'addMissingTokenSortKeys',
      buildNo: 1
    }, {
      name: 'removeTokensOfDeletedOutbreak',
      buildNo: 1
    }]
  }, {
    fileName: 'outbreak.js',
    actions: [{
      name: 'addMissingDefaultValues',
      buildNo: 1
    }]
  }, {
    fileName: 'template.js',
    actions: [{
      name: 'addMissingDefaultValues',
      buildNo: 1
    }]
  }, {
    fileName: 'followUp.js',
    actions: [{
      name: 'setUsualPlaceOfResidenceLocationIdOnFollowUp',
      buildNo: 1
    }]
  }]
}, {
  version: '2.36.4',
  scripts: [{
    fileName: 'outbreak.js',
    actions: [{
      name: 'updateMapServers',
      buildNo: 1
    }]
  }]
}, {
  version: '2.38.0',
  scripts: [{
    fileName: 'person.js',
    actions: [{
      name: 'updateMissingDuplicateKeys',
      buildNo: 1
    }]
  }, {
    fileName: 'labResults.js',
    actions: [{
      name: 'updatePersonType',
      buildNo: 1
    }]
  }, {
    fileName: 'missing-property-deleted.js',
    actions: [{
      name: 'addMissingDeletedProperty',
      buildNo: 1
    }]
  }]
}, {
  version: '2.38.1',
  scripts: [{
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 9
    }]
  }]
}, {
  version: '2.39.0',
  scripts: [{
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 19
    }, {
      name: 'checkAndRemoveLanguageTokens',
      buildNo: 3
    }, {
      name: 'checkAndAddMissingLanguageTokens',
      buildNo: 2
    }]
  }]
}, {
  version: '2.40.0',
  scripts: [{
    fileName: 'template.js',
    actions: [{
      name: 'createUpdateDefaultOutbreakTemplates',
      buildNo: 19
    }]
  }, {
    fileName: 'referenceData.js',
    actions: [{
      name: 'createUpdateDefaultReferenceData',
      buildNo: 4
    }]
  }, {
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 18
    }, {
      name: 'createUpdateSingleFrenchLanguageTokens',
      buildNo: 1
    }]
  }, {
    fileName: 'person.js',
    actions: [{
      name: 'updateNumberOfExposuresAndContacts',
      buildNo: 2
    }]
  }]
}, {
  version: '2.40.2',
  scripts: [{
    fileName: 'referenceData.js',
    actions: [{
      name: 'createUpdateDefaultReferenceData',
      buildNo: 4
    }]
  }, {
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 1
    }]
  }]
}, {
  version: '2.41.0',
  scripts: [{
    fileName: 'referenceData.js',
    actions: [{
      name: 'createUpdateDefaultReferenceData',
      buildNo: 3
    }]
  }, {
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 27
    }, {
      name: 'createUpdateSingleFrenchLanguageTokens',
      buildNo: 5
    }]
  }]
}, {
  version: '2.42.0',
  scripts: [{
    fileName: 'template.js',
    actions: [{
      name: 'createUpdateDefaultOutbreakTemplates',
      buildNo: 1
    }]
  }, {
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 9
    }]
  }]
}, {
  version: '2.43.0',
  scripts: [{
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 2
    }]
  }, {
    fileName: 'outbreak.js',
    actions: [{
      name: 'cleanUnnecessaryData',
      buildNo: 1
    }]
  }]
}, {
  version: '2.44.0',
  scripts: [{
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 5
    }]
  }, {
    fileName: 'outbreak.js',
    actions: [{
      name: 'cleanUnnecessaryData',
      buildNo: 1
    }]
  }, {
    fileName: 'person.js',
    actions: [{
      name: 'setUsualPlaceOfResidenceLocationIdOnPerson',
      buildNo: 2
    }]
  }, {
    fileName: 'followUp.js',
    actions: [{
      name: 'setUsualPlaceOfResidenceLocationIdOnFollowUp',
      buildNo: 2
    }]
  }]
}, {
  version: '2.45.0',
  scripts: [{
    fileName: 'referenceData.js',
    actions: [{
      name: 'createUpdateDefaultReferenceData',
      buildNo: 1
    }]
  }, {
    fileName: 'template.js',
    actions: [{
      name: 'createUpdateDefaultOutbreakTemplates',
      buildNo: 5
    }]
  }, {
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 40
    }]
  }, {
    fileName: 'missing-property-deleted.js',
    actions: [{
      name: 'addMissingDeletedProperty',
      buildNo: 9
    }]
  }, {
    fileName: 'person.js',
    actions: [{
      name: 'deleteRelatedDataIfPersonDeleted',
      buildNo: 11
    }]
  }]
}, {
  version: '2.46.0',
  scripts: [{
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 20
    }, {
      name: 'createUpdateSingleEnglishLanguageTokens',
      buildNo: 1
    }, {
      name: 'createUpdateSingleSpanishLanguageTokens',
      buildNo: 1
    }, {
      name: 'createUpdateSinglePortugueseLanguageTokens',
      buildNo: 1
    }]
  }, {
    fileName: 'role.js',
    actions: [{
      name: 'addMissingPermission',
      buildNo: 3
    }]
  }]
}, {
  version: '2.47.0',
  scripts: [{
    fileName: 'languageToken.js',
    actions: [{
      name: 'createUpdateLanguageTokens',
      buildNo: 30
    }, {
      name: 'createUpdateSingleEnglishLanguageTokens',
      buildNo: 1
    }]
  }]
}];

/**
 * Walk through the migrationVersions and get actions that need to be executed based on the last execution map
 * Will throw error if it was unable to read migration scripts from version folder or required actions are not defined in scripts
 * @param lastExecutionMap
 * @return {Object} Contains list of action entries for the ones that need to be executed and map for already executed actions
 */
const getActionsForExecutionMap = function (lastExecutionMap = []) {
  let result = {
    actionsForExecution: [],
    mapForAlreadyExecutedActions: []
  };

  // loop through the versions
  migrationVersions.forEach(versionEntry => {
    // loop through the version scripts
    versionEntry.scripts.forEach(scriptEntry => {
      // loop through the script actions
      scriptEntry.actions.forEach(actionEntry => {
        let actionPath = `${versionEntry.version}/${scriptEntry.fileName}/${actionEntry.name}`;

        // check for action presence in last execution map
        let actionLastExecutedEntry = lastExecutionMap.find(actionEntry => actionEntry.name === actionPath);
        let actionLastExecutedBuildNo = actionLastExecutedEntry ? actionLastExecutedEntry.buildNo : null;

        if (actionLastExecutedBuildNo !== actionEntry.buildNo) {
          // load script only if action needs to be executed
          let script = require(Path.resolve(migrationVersionsFoldersPath, versionEntry.version, scriptEntry.fileName));
          // validate that action actually exists in script
          if (typeof script[actionEntry.name] !== 'function') {
            throw `Action '${actionPath}' is not defined`;
          }

          // need to execute action
          result.actionsForExecution.push({
            name: actionPath,
            action: script[actionEntry.name],
            buildNo: actionEntry.buildNo
          });
        } else {
          // action was already executed
          result.mapForAlreadyExecutedActions.push({
            name: actionPath,
            buildNo: actionEntry.buildNo
          });
        }
      });
    });
  });

  return result;
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

  let migrationLogCollection, migrationLogInstanceId, actionsToBeExecuted, executionMap;

  // create Mongo DB connection
  return MongoDBHelper
    .getMongoDBConnection({
      ignoreUndefined: DataSources.mongoDb.ignoreUndefined
    })
    .then(dbConn => {
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
            startDate: -1
          },
          projection: {
            executionMap: 1
          }
        })
        .toArray();
    })
    .then(lastMigration => {
      try {
        let result = getActionsForExecutionMap(lastMigration.length && lastMigration[0].executionMap ? lastMigration[0].executionMap : []);
        actionsToBeExecuted = result.actionsForExecution;
        executionMap = result.mapForAlreadyExecutedActions;
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
          startDate: new Date(),
          executionMap: executionMap,
          deleted: false
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
            executionMap.push({
              name: actionEntry.name,
              buildNo: actionEntry.buildNo
            });
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
            endDate: new Date(),
            error: err.toString ? err.toString() : JSON.stringify(err)
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

// execute model migration scripts
module.exports = run;
