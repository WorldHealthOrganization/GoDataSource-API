'use strict';

const app = require('../../server/server');
const path = require('path');
const _ = require('lodash');
const fs = require('fs');

module.exports = function (SystemSettings) {

  SystemSettings.imageTypes = {
    SVG: 'SVG',
    PNG: 'PNG'
  };

  // initialize system settings cache
  SystemSettings.cache;

  /**
   * Validate client credentials.clientId uniqueness
   * Validate upstream servers url uniqueness
   */
  SystemSettings.observe('before save', function (context, callback) {
    // initialize validation error
    let errorMessages = '', errorInfo = {};

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
        errorMessages = `Client IDs must be unique. Duplicate client IDs: ${duplicateClientIDs.join(', ')}. `;
        errorInfo.duplicateClientIDs = duplicateClientIDs;
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
        errorMessages += `Server URLs must be unique. Duplicate server URLs: ${duplicateServerURLs.join(', ')}.`;
        errorInfo.duplicateServerURLs = duplicateServerURLs;
      }
    }

    // get configured backup location
    const contextData = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    const backupLocation = _.get(contextData, 'source.all.dataBackup.location');
    const resolvedBackupLocation = path.resolve(backupLocation);

    // check if backup location is accessible for read and writes
    fs.access(resolvedBackupLocation, fs.constants.R_OK | fs.constants.W_OK, function (error) {
      // if error occurred
      if (error) {
        // save error
        errorMessages += `Configured backup location ${backupLocation} is not accessible for read/write`;
        errorInfo.backupLocation = {
          path: backupLocation,
          resolvedPath: resolvedBackupLocation,
          error: error
        };
      }

      // if everything went fine, use resolved backup location
      _.set(contextData, 'target.dataBackup.location', resolvedBackupLocation);

      // check for validation error
      if (errorMessages.length) {
        errorInfo.errorMessages = errorMessages;
        return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', errorInfo));
      }

      return callback();
    });
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
};
