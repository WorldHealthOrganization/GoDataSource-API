'use strict';

const app = require('../../server/server');

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
          app.models[modelName].find(_filter)
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
};
