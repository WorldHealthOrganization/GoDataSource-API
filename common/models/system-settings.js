'use strict';

const app = require('../../server/server');
const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const config = require('../../server/config');
const uuid = require('uuid');

module.exports = function (SystemSettings) {

  // initialize system settings cache
  SystemSettings.cache;

  /**
   * Validate client credentials.clientId uniqueness
   * Validate upstream servers url uniqueness
   */
  SystemSettings.observe('before save', function (context, callback) {
    // get clients
    let clients = context.instance ? context.instance.clientApplications : context.data.clientApplications;

    // check if clients are set
    if (Array.isArray(clients)) {
      // initialize map of client IDs in order to find duplicates
      let clientIDs = {};
      clients.forEach(function (client) {
        let clientID = client.credentials.clientId;
        if (!clientIDs[clientID]) {
          // initialize counter for client ID
          clientIDs[clientID] = 0;
        }
        clientIDs[clientID]++;
      });

      // get duplicate client IDs
      let duplicateClientIDs = Object.keys(clientIDs).filter(clientID => clientIDs[clientID] > 1);
      if (duplicateClientIDs.length) {
        // duplicate client IDs were found; return validation error
        return callback(app.utils.apiError.getError(
          'REQUEST_VALIDATION_ERROR_DUPLICATE_CLIENT_IDS', {
            errorMessages: `Client IDs must be unique. Duplicate client IDs: ${duplicateClientIDs.join(', ')}. `,
            duplicateClientIDs: duplicateClientIDs
          }
        ));
      }
    }

    // get upstream servers
    let upstreamServers = context.instance ? context.instance.upstreamServers : context.data.upstreamServers;

    // check if servers are set
    if (Array.isArray(upstreamServers)) {
      // initialize map of server URLs in order to find duplicates
      let serverURLs = {};
      upstreamServers.forEach(function (server) {
        let serverURL = server.url;
        if (!serverURLs[serverURL]) {
          // initialize counter for server URL
          serverURLs[serverURL] = 0;
        }
        serverURLs[serverURL]++;
      });

      // get duplicate server URLs
      let duplicateServerURLs = Object.keys(serverURLs).filter(serverURL => serverURLs[serverURL] > 1);
      if (duplicateServerURLs.length) {
        // duplicate server URLs were found; return validation error
        return callback(app.utils.apiError.getError(
          'REQUEST_VALIDATION_ERROR_DUPLICATE_SERVER_IDS', {
            errorMessages: `Server URLs must be unique. Duplicate server URLs: ${duplicateServerURLs.join(', ')}.`,
            duplicateServerURLs: duplicateServerURLs
          }
        ));
      }
    }

    // check if backup settings were sent; all are required
    if (context.instance && context.instance.dataBackup || context.data.dataBackup) {
      // get configured backup location
      const contextData = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
      const backupLocation = _.get(contextData, 'source.all.dataBackup.location');
      const resolvedBackupLocation = path.resolve(backupLocation);

      // check if backup location is accessible for read and writes
      fs.access(resolvedBackupLocation, fs.constants.R_OK | fs.constants.W_OK, function (error) {
        // if error occurred
        if (error) {
          // save error
          return callback(app.utils.apiError.getError(
            'REQUEST_VALIDATION_ERROR_INVALID_BACKUP_LOCATION', {
              errorMessages: `Configured backup location ${backupLocation} is not accessible for read/write`,
              backupLocation: {
                path: backupLocation,
                resolvedPath: resolvedBackupLocation,
                error: error
              }
            }
          ));
        }

        // if everything went fine, use resolved backup location
        // need to also set the other dataBackup properties as they would be reset when setting the dataBackup location
        // need to start from the source as the target might not contain dataBackup
        _.set(contextData, 'target.dataBackup', Object.assign(_.get(contextData, 'source.all.dataBackup', {}), _.get(contextData, 'target.dataBackup', {})));
        _.set(contextData, 'target.dataBackup.location', resolvedBackupLocation);

        // finished
        return callback();
      });
    } else {
      // finished
      return callback();
    }
  });

  /**
   * Get system settings from cache;
   * if the cache is not set get them from DB
   * @returns {*}
   */
  SystemSettings.getCache = function () {
    if (SystemSettings.cache) {
      return Promise.resolve(SystemSettings.cache);
    }

    // cache is not set; get system settings
    return new Promise(function (resolve, reject) {
      SystemSettings.getSystemSettings(function (err, settings) {
        if (err) {
          // we tried to get the system settings and we got an error
          app.logger.debug(`Failed to cache the system settings: ${err}`);
          reject(err);
        } else {
          SystemSettings.cache = settings;
          app.logger.debug('Successfully cached the system settings');
          resolve(settings);
        }
      });
    });
  };

  // after the application started (all models finished loading)
  // get the system settings and cache them
  app.on('started', function () {
    // not handling then as we don't need the setting here
    // not doing anything on catch since the error was already logged
    SystemSettings
      .getCache()
      .catch(function (err) {
        // nothing to do; See above comments
        app.logger.debug(`Failed to cache the system settings at startup: ${err}`);
      });
  });

  /**
   * Cache the system settings after each change
   */
  SystemSettings.observe('after save', function (context, callback) {
    SystemSettings.cache = context.instance;
    app.logger.debug('Successfully cached the system settings');
    callback();
  });

  /**
   * Get default ArcGis Servers
   * @return {Array}
   */
  SystemSettings.getDefaultArcGisServers = function () {
    // start with an empty list of default servers
    const arcGisServers = [];
    // read default information from config
    const configArcGisServers = _.get(config, 'defaultArcGisServers', []);
    // do some basic validation of config data
    if (Array.isArray(configArcGisServers) && configArcGisServers.length) {
      // go through configured ArcGis servers
      configArcGisServers.forEach(function (arcGisServer) {
        // add arcGis server only if it has URL defined
        if (arcGisServer.url) {
          arcGisServers.push({
            name: arcGisServer.name,
            url: arcGisServer.url
          });
        }
      });
    }
    return arcGisServers;
  };

  SystemSettings.migrate = function (opts, next) {
    const db = app.dataSources.mongoDb.connector;
    return db.connect(() => {
      const collection = db.collection('systemSettings');
      return collection.findOne()
        .then(instance => {
          if (instance) {
            // get through system settings client apps
            // make sure each client has an id
            instance.clientApplications = (instance.clientApplications || []).map(app => {
              app.id = app.id || uuid.v4();
              return app;
            });

            return collection.updateOne({ _id: instance.id }, instance)
              .then(next)
              .catch(next);
          }
          return next();
        });
    });
  };
};
