'use strict';

const app = require('../../server/server');
const dbSync = require('../../components/dbSync');
const _ = require('lodash');
const url = require('url');
const path = require('path');
const fs = require('fs');
const extendedPersistedModelConstants = require('../../components/baseModelOptions/extendedPersistedModel').constants;

module.exports = function (ExtendedPersistedModel) {
  // shortcut to Extended Persisted Model
  const EPM = ExtendedPersistedModel;
  // set flag to force writing a controller for each model or update the flag
  ExtendedPersistedModel.hasController = true;

  ExtendedPersistedModel.fieldLabelsMap = extendedPersistedModelConstants.fieldLabelsMap;

  // some models can be referenced by other models and they have restrictions on actions like delete
  // build a map of usages that can be checked later
  ExtendedPersistedModel.possibleRecordUsage = {};

  // define custom relations related to user ( create & modified by user ) supported by all extended models
  ExtendedPersistedModel.userSupportedRelations = [
    'createdByUser',
    'updatedByUser',
    'responsibleUser'
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
   * @param recordId string | string[]
   * @param filter
   * @param justCount
   * @param stopAtFirstFind - justCount needs to be true for this option to be used
   * @return {Promise<any[] | never>}
   */
  ExtendedPersistedModel.findModelUsage = function (
    recordId,
    filter,
    justCount,
    stopAtFirstFind
  ) {
    // conditions
    const conditions = [];
    // cache model name form the child model that used the function
    const currentModelName = this.modelName;
    // get list of model names (if any)
    const modelNames = EPM.possibleRecordUsage[currentModelName] ? Object.keys(EPM.possibleRecordUsage[currentModelName]) : [];
    // go through possible usage list
    modelNames.forEach(function (modelName) {
      const orQuery = [];
      // build a search query using the fields that might contain the information
      const operatorIn = justCount && (!stopAtFirstFind || !app.models[modelName].rawCountDocuments) ? 'in' : '$in';
      EPM.possibleRecordUsage[currentModelName][modelName].forEach(function (field) {
        orQuery.push({
          [field]: Array.isArray(recordId) ? {[operatorIn]: recordId} : recordId
        });
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
        conditions.push({
          modelName,
          where: _filter.where
        });
      } else {
        conditions.push({
          modelName,
          where: _filter.where
        });
      }
    });

    // execute in series until we find one
    if (
      justCount &&
      stopAtFirstFind
    ) {
      return new Promise((resolve, reject) => {
        // next promise
        const nextPromise = () => {
          // finished - nothing found
          if (conditions.length < 1) {
            resolve({});
            return;
          }

          // first promise
          const condition = conditions.shift();
          (
            app.models[condition.modelName].rawCountDocuments ?
              app.models[condition.modelName].rawCountDocuments(
                {
                  where: condition.where,
                  limit: 1
                }) :
              // limit not supported
              app.models[condition.modelName].count(condition.where)
          )
            .then((response) => {
              // found ?
              if (
                (
                  typeof response === 'number' &&
                  response > 0
                ) || (
                  response &&
                  typeof response.count === 'number' &&
                  response.count > 0
                )
              ) {
                resolve({
                  [condition.modelName]: typeof response === 'number' ?
                    response :
                    response.count
                });
                return;
              }

              // not used so far, continue search
              nextPromise();
            })
            .catch(reject);
        };

        // start
        nextPromise();
      });
    } else {
      // execute
      return Promise.all(conditions.map((condition) => justCount ? app.models[condition.modelName].count(condition.where) : app.models[condition.modelName].rawFind(condition.where)))
        .then(function (results) {
          // associate the results with the queried models
          const resultSet = {};
          results.forEach(function (result, index) {
            resultSet[modelNames[index]] = result;
          });
          return resultSet;
        });
    }
  };


  /**
   * Check if a record is in use
   * @param recordId string | string[]
   * @return {Promise<boolean | never>}
   */
  ExtendedPersistedModel.isRecordInUse = function (recordId) {
    // important: use exact model that called the function, model name is used in business logic
    return this.findModelUsage(recordId, {}, true, true)
      .then(function (results) {
        // if the usage count is greater than 1, model is in use
        return Object.values(results).reduce(function (a, b) {
          return a + b;
        }, 0) > 0;
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
      .findOne()
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
   * Retrieve createdByUser, updatedByUser, responsibleUser relations
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
          const port = urlInfo.port ? urlInfo.port : '';
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
          _.get(context, 'req.method') === 'PATCH' ||
          _.get(context, 'req.method') === 'POST'
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
            (relName) => ({relation: relName})
          )
        );
      }
    }

    // nothing to do here anymore, we can continue to the next step
    next();
  });

  /**
   * Retrieve createdByUser, updatedByUser, responsibleUser relations
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
   * Retrieve and map createdByUser, responsibleUser relations data
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
      const includeCreatedByUser = !!_.find(userRelations, {relation: 'createdByUser'});
      const includeUpdatedByUser = !!_.find(userRelations, {relation: 'updatedByUser'});
      const includeResponsibleUser = !!_.find(userRelations, {relation: 'responsibleUser'});

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

          // responsible user
          if (
            includeResponsibleUser &&
            record.responsibleUserId &&
            record.responsibleUserId !== 'unavailable'
          ) {
            userIds[record.responsibleUserId] = true;
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
            },
            fields: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              deleted: true
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

                // responsible user
                if (
                  includeResponsibleUser &&
                  record.responsibleUserId &&
                  users[record.responsibleUserId]
                ) {
                  record.responsibleUser = users[record.responsibleUserId];
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
