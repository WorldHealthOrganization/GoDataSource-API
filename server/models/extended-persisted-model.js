'use strict';

const app = require('../../server/server');
const dbSync = require('../../components/dbSync');
const _ = require('lodash');
const url = require('url');
const path = require('path');
const fs = require('fs');

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

  // define custom relations related to user ( create & modified by user ) supported by all extended models
  ExtendedPersistedModel.userSupportedRelations = [
    'createdByUser',
    'updatedByUser'
  ];

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

  /**
   * Retrieve createdByUser, updatedByUser relations
   * - At this point this works only for the first level includes, later this can be extended to take in scan relations scopes to see if we want to include user data in child relations as well
   * - At this point filters on user relationships don't work, in case we need to add support for this then we will need to allow inclusion on all count methods as well
   */
  app.remotes().before('**', function (context, next) {
    let config = require('../config');

    if (config.enableConfigRewrite) {
      // retrieve domain from client url
      const origin = context.req.get('origin');
      if (!_.isEmpty(origin)) {
        // retrieve url info
        const urlInfo = url.parse(origin);
        if (
          urlInfo && (
            urlInfo.hostname &&
            urlInfo.hostname.toLowerCase() !== 'localhost' &&
            urlInfo.hostname.toLowerCase() !== '127.0.0.1'
          )
        ) {
          // make sure we always check the latest values
          const filename = path.resolve(`${__dirname}/../config.json`);
          delete require.cache[filename];
          config = require('../config');

          // protocol changed?
          const protocolChanged = urlInfo.protocol &&
            _.get(config, 'public.protocol').toLowerCase() !== urlInfo.protocol.replace(':', '').toLowerCase();

          // host changed
          const hostChanged = urlInfo.hostname &&
            _.get(config, 'public.host').toLowerCase() !== urlInfo.hostname.toLowerCase();

          // port changed ?
          const port = urlInfo.port === null ? '80' : urlInfo.port;
          const portChanged = port &&
            _.get(config, 'public.port').toString().toLowerCase() !== port.toString().toLowerCase();

          // check if we need to update host information
          if (
            protocolChanged ||
            hostChanged ||
            portChanged
          ) {
            // change protocol ?
            if (protocolChanged) {
              _.set(config, 'public.protocol', urlInfo.protocol.replace(':', ''));
            }

            // change host ?
            if (hostChanged) {
              _.set(config, 'public.host', urlInfo.hostname);
            }

            // change port
            if (portChanged) {
              _.set(config, 'public.port', port);
            }

            // save data into file
            // update configuration
            const configPath = path.resolve(__dirname + '/../config.json');
            fs.writeFileSync(
              configPath,
              JSON.stringify(config, null, 2)
            );

            // config saved
            app.logger.info(
              'Config file ( %s ) public data updated to: %s taken FROM %s',
              configPath,
              JSON.stringify(config.public),
              JSON.stringify(urlInfo)
            );
          }
        }
      }
    }

    // including user relations apply only to GET requests
    if (
      _.get(context, 'req.method') === 'GET' || (
        (
          _.get(context, 'req.method') === 'PUT' ||
          _.get(context, 'req.method') === 'PATCH'
        ) &&
        _.get(context, 'req.query.retrieveCreatedUpdatedBy')
      )
    ) {
      // determine if this request tries to include create / update user data
      // retrieveCreatedUpdatedBy can be used to retrieve all relationships
      const includeFilter = _.get(context, 'args.filter.include') || {};
      const createUpdateRelations = _.filter(includeFilter, (rel) => ExtendedPersistedModel.userSupportedRelations.indexOf(rel.relation) > -1);
      if (createUpdateRelations.length > 0) {
        // we have user relations, so we need to do some cleanup before allowing request to retrieve data
        // filter out user relations since these will be handled later in after remote
        _.set(
          context,
          'args.filter.include',
          _.filter(
            includeFilter,
            (rel) => ExtendedPersistedModel.userSupportedRelations.indexOf(rel.relation) < 0
          )
        );

        // there is no point in retrieving
        if (
          _.get(context, 'method.returns.0.arg') === 'count'
        ) {
          // nothing to do when counting records
        } else {
          // send further data to be processed
          _.set(
            context,
            'req.options._userRelations',
            createUpdateRelations
          );
        }

      // retrieveCreatedUpdatedBy can be used to retrieve all relationships
      } else if (_.get(context, 'req.query.retrieveCreatedUpdatedBy')) {
        _.set(
          context,
          'req.options._userRelations',
          _.map(
            ExtendedPersistedModel.userSupportedRelations,
            (relName) => ({ relation: relName })
          )
        );
      }
    }

    // nothing to do here anymore, we can continue to the next step
    next();
  });

  /**
   * Retrieve createdByUser, updatedByUser relations
   * - At this point this works only for the first level includes, later this can be extended to take in scan relations scopes to see if we want to include user data in child relations as well
   * - At this point filters on user relationships don't work, in case we need to add support for this then we will need to allow inclusion on all count methods as well
   */
  app.remotes().after('**', function (context, next) {
    // check if we need to retrieve user data
    ExtendedPersistedModel.retrieveUserSupportedRelations(
      context,
      context.result,
      next
    );
  });

  /**
   * Retrieve and map createdByUser, updatedByUser relations data
   * @param context
   * @param returnedResult
   * @param next
   */
  ExtendedPersistedModel.retrieveUserSupportedRelations = function (context, returnedResult, next) {
    // check if we need to retrieve user data
    const userRelations = _.get(context, 'req.options._userRelations');
    if (
      userRelations &&
      userRelations.length > 0
    ) {
      // cleanup
      delete context.req.options._userRelations;

      // determine relations for which we need to retrieve data
      const includeCreatedByUser = !!_.find(userRelations, { relation: 'createdByUser' });
      const includeUpdatedByUser = !!_.find(userRelations, { relation: 'updatedByUser' });

      // determine results for which we need to map the user data
      const result = _.isArray(returnedResult) ?
        returnedResult :
        [returnedResult];

      // determine the user for which we need to retrieve data
      const userIds = {};
      _.each(
        result,
        (record) => {
          // created by user
          if (
            includeCreatedByUser &&
            record.createdBy &&
            record.createdBy !== 'unavailable'
          ) {
            userIds[record.createdBy] = true;
          }

          // updated by user
          if (
            includeUpdatedByUser &&
            record.updatedBy &&
            record.updatedBy !== 'unavailable'
          ) {
            userIds[record.updatedBy] = true;
          }
        }
      );

      // there is no point to retrieve user if we have nothing to retrieve
      if (!_.isEmpty(userIds)) {
        // retrieve user data
        app.models.user
          .find({
            deleted: true,
            where: {
              id: {
                inq: Object.keys(userIds)
              }
            }
          })
          .then((users) => {
            // clean user models of  sensitive data like password hashes etc
            users = _.transform(
              users,
              (acc, user) => {
                acc[user.id] = user.toJSON();
              },
              {}
            );

            // map user data to models
            _.each(
              result,
              (record) => {
                // created by user
                if (
                  includeCreatedByUser &&
                  record.createdBy &&
                  users[record.createdBy]
                ) {
                  record.createdByUser = users[record.createdBy];
                }

                // updated by user
                if (
                  includeUpdatedByUser &&
                  record.updatedBy &&
                  users[record.updatedBy]
                ) {
                  record.updatedByUser = users[record.updatedBy];
                }
              }
            );

            // finished
            next();
          });

        // finished
        return;
      }
    }

    // nothing to do here anymore, we can continue to the next step
    next();
  };
};
