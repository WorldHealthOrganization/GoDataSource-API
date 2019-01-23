'use strict';

const app = require('../../server/server');
const dbSync = require('../../components/dbSync');

module.exports = function (ExtendedPersistedModel) {
  // shortcut to Extended Persisted Model
  const EPM = ExtendedPersistedModel;
  // set flag to force writing a controller for each model or update the flag
  ExtendedPersistedModel.hasController = true;

  ExtendedPersistedModel.fieldLabelsMap = {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdAt: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT'
  };

  // some models can be referenced by other models and they have restrictions on actions like delete
  // build a map of usages that can be checked later
  ExtendedPersistedModel.possibleRecordUsage = {};

  // after the application started (all models finished loading)
  app.on('started', function () {
    // set a map of monitored fields to model
    EPM.possibleRecordUsageMonitoredFieldsMap = {
      locationFields: app.models.location,
      referenceDataFields: app.models.referenceData
    };
    // shortcut to possible record usage monitored fields map
    const PRUMFM = 'possibleRecordUsageMonitoredFieldsMap';
    // go through all models
    app.models().forEach(function (Model) {
      // person is an abstract model, don't monitor it
      if (Model.modelName !== app.models.person.modelName) {
        // go through the list of monitored fields
        Object.keys(EPM[PRUMFM]).forEach(function (monitoredField) {
          // get their list of location fields
          if (Array.isArray(Model[monitoredField])) {
            // build possible record usage lists per model
            if (!EPM.possibleRecordUsage[EPM[PRUMFM][monitoredField].modelName]) {
              EPM.possibleRecordUsage[EPM[PRUMFM][monitoredField].modelName] = {};
            }
            // do not add models that don't have find functionality
            if (typeof Model.find === 'function') {
              // build possible record usage list
              EPM.possibleRecordUsage[EPM[PRUMFM][monitoredField].modelName][Model.modelName] = Model[monitoredField].map(function (recordField) {
                // some fields contain array markers ([]) needed by some business logic, remove those here
                return recordField.replace(/\[]/g, '');
              });
            }
          }
        });
      }
    });
  });

  /**
   * Get usage for a record
   * @param recordId
   * @param filter
   * @param justCount
   * @return {Promise<any[] | never>}
   */
  ExtendedPersistedModel.findModelUsage = function (recordId, filter, justCount) {
    // build a list of check usage actions
    const checkUsages = [];
    // cache model name form the child model that used the function
    const currentModelName = this.modelName;
    // get list of model names (if any)
    const modelNames = EPM.possibleRecordUsage[currentModelName] ? Object.keys(EPM.possibleRecordUsage[currentModelName]) : [];
    // go through possible usage list
    modelNames.forEach(function (modelName) {
      const orQuery = [];
      // build a search query using the fields that might contain the information
      EPM.possibleRecordUsage[currentModelName][modelName].forEach(function (field) {
        orQuery.push({[field]: recordId});
      });

      // build filter
      const _filter = app.utils.remote
        .mergeFilters({
          where: {
            or: orQuery
          }
        }, filter);

      // count/find the results
      if (justCount) {
        checkUsages.push(
          app.models[modelName].count(_filter.where)
        );
      } else {
        checkUsages.push(
          app.models[modelName].rawFind(_filter.where)
        );
      }
    });
    return Promise.all(checkUsages)
      .then(function (results) {
        // associate the results with the queried models
        const resultSet = {};
        results.forEach(function (result, index) {
          resultSet[modelNames[index]] = result;
        });
        return resultSet;
      });
  };


  /**
   * Check if a record is in use
   * @param recordId
   * @return {Promise<boolean | never>}
   */
  ExtendedPersistedModel.isRecordInUse = function (recordId) {
    // important: use exact model that called the function, model name is used in business logic
    return this.findModelUsage(recordId, {}, true)
      .then(function (results) {
        // if the usage count is greater than 1, model is in use
        return Object.values(results).reduce(function (a, b) {
          return a + b;
        }) > 0;
      });
  };

  /**
   * Add sync on every change if needed
   */
  ExtendedPersistedModel.observe('after save', function (context, callback) {
    // check if the update is not already in a sync action
    // we won't sync on changes done in a sync action or init action
    if (context.options._sync || context.options._init) {
      return callback();
    }

    // check if the model is a model that can be synced
    let modelName = context.Model.modelName;
    if (dbSync.syncModels.indexOf(modelName) === -1) {
      // model is not in the list of models that can be synced
      return callback();
    }

    // continue check for sync on every change
    // check if sync on every change is needed for any of the servers
    // get system settings to do these checks
    app.models.systemSettings
      .getCache()
      .then(function (systemSettings) {
        let upstreamServers = systemSettings.upstreamServers || [];
        // get servers which have sync enabled and syncOnEveryChange flag set as true
        let serversToSync = upstreamServers.filter(function (server) {
          return server.syncEnabled && server.syncOnEveryChange;
        });

        if (!serversToSync.length) {
          // there are no servers to sync
          return callback();
        }

        // get the sync maps to know if the sync needs to be triggered or will be added in the pending list
        let syncModel = app.models.sync;
        let syncInPendingMap = syncModel.pending.servers;

        // go through the servers to sync and add the server in the pending sync list if there is another sync in progress for the same server
        // the sync will be started if there is no other sync in progress for the same server
        serversToSync.forEach(function (server) {
          app.logger.debug(`Sync on every change is enabled for server '${server.name}'`);
          // add the server on the pending sync list
          syncInPendingMap[server.url] = true;
          // trigger sync
          syncModel.checkAndTriggerPendingSync(server, context.options);
        });

        return callback();
      })
      .catch(function (err) {
        app.logger.debug(`Failed to get the system settings to check if any upstream server is configured for sync on every change. Error: ${err}`);
      });
  });
};
