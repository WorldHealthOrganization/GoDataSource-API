'use strict';

const app = require('../../server/server');
const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const config = require('../../server/config');

module.exports = function (SystemSettings) {

  /**
   * Validate upstream servers url uniqueness
   */
  SystemSettings.observe('before save', function (context, callback) {
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
            url: arcGisServer.url,
            type: arcGisServer.type,
            styleUrl: arcGisServer.styleUrl,
            styleUrlSource: arcGisServer.styleUrlSource
          });
        }
      });
    }
    return arcGisServers;
  };
};
