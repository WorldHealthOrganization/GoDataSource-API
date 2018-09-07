'use strict';

const request = require('request');
const fs = require('fs');
const tmp = require('tmp');
const qs = require('querystring');
const app = require('../server/server');

/**
 * Remove last character of a string if it's a '/'
 * @param url
 */
function normalizeURL(url) {
  if (typeof url === 'string' && url.lastIndexOf('/') === url.length - 1) {
    url = url.substring(0, url.length - 1);
  }

  return url;
}

/**
 * Constructor for client for sync requests
 * @param upstreamServer
 * @param syncLogEntry
 * @constructor
 */
const SyncClient = function (upstreamServer, syncLogEntry) {
  // initialize request options
  this.options = {
    baseUrl: normalizeURL(upstreamServer.url),
    auth: {
      user: upstreamServer.credentials.clientId,
      pass: upstreamServer.credentials.clientSecret
    },
    timeout: upstreamServer.timeout
  };

  // keep upstream server information for future use
  this.upstreamServerName = upstreamServer.name;
  this.upstreamServerURL = upstreamServer.url;
  this.syncLogEntry = syncLogEntry;

  /**
   * Get available outbreaks IDs list
   * @returns {Promise}
   */
  this.getAvailableOutbreaks = function () {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'sync/available-outbreaks',
      json: true
    });

    return new Promise(function (resolve, reject) {
      // get the available outbreaks IDs
      request(requestOptions, function (error, response, body) {
        if (error) {
          return reject(error);
        } else {
          // body contains the outbreakIDs; return them
          resolve(Array.isArray(body.outbreakIDs) ? body.outbreakIDs : []);
        }
      });
    })
  };

  /**
   * Send database to server for import
   * @param DBSnapshotFileName
   * @param asynchronous
   * @returns {Promise}
   */
  this.sendDBSnapshotForImport = function (DBSnapshotFileName, asynchronous) {
    let requestOptions = Object.assign(this.options, {
      method: 'POST',
      uri: 'sync/import-database-snapshot',
      formData: {
        snapshot: fs.createReadStream(DBSnapshotFileName),
        asynchronous: asynchronous
      }
    });

    return new Promise(function (resolve, reject) {
      request(requestOptions, function (error, response, body) {
        if (error) {
          return reject(error);
        } else {
          // parse body to JSON
          try {
            body = JSON.parse(body);
            // body contains the sync log ID; return it
            resolve(body.syncLogId);
          } catch (parseError) {
            reject(parseError);
          }
        }
      });
    })
  };

  /**
   * GET sync log entry for given ID
   * @param syncLogId
   * @returns {Promise}
   */
  this.getSyncLogEntry = function (syncLogId) {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'sync-logs/' + syncLogId,
      json: true
    });

    return new Promise(function (resolve, reject) {
      request(requestOptions, function (error, response, body) {
        if (error) {
          return reject(error);
        } else {
          resolve(body);
        }
      });
    })
  };

  /**
   * GET export log entry for given ID
   * @param syncLogId
   * @returns {Promise}
   */
  this.getExportLogEntry = function (exportLogId) {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'database-export-logs/' + exportLogId,
      json: true
    });

    return new Promise(function (resolve, reject) {
      request(requestOptions, function (error, response, body) {
        if (error) {
          return reject(error);
        } else {
          resolve(body);
        }
      });
    })
  };

  /**
   * GET database snapshot from server
   * Database export is done in sync mode
   * @param filter Filter to be sent in the request
   * @returns {Promise}
   */
  this.getDatabaseSnapshot = function (filter) {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'sync/database-snapshot',
      qs: {
        filter: JSON.stringify(filter)
      }
    });

    // get path for saving the DB; will be saved in system tmp directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;
    let dbSnapshotFileName = `${tmpDirName}/db_snapshot_${this.upstreamServerName}_${Date.now()}.tar.gz`;

    return new Promise(function (resolve, reject) {
      request(requestOptions)
        .on('response', function (response) {
          app.logger.debug(response.status);
        })
        .on('error', function (error) {
          reject(error);
        })
        .pipe(fs.createWriteStream(dbSnapshotFileName))
        .on('finish', function() {
          resolve(dbSnapshotFileName);
        })
      ;
    });
  };

  /**
   * Trigger database export on the server
   * @param filter Filter to be sent in the request
   * @returns {Promise}
   */
  this.triggerUpstreamServerDatabaseExport = function (filter) {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'sync/database-snapshot-asynchronous',
      json: true,
      qs: {
        filter: JSON.stringify(filter)
      }
    });

    return new Promise(function (resolve, reject) {
      // get the exportLog ID
      request(requestOptions, function (error, response, body) {
        if (error) {
          return reject(error);
        } else {
          // body contains the exportLogId; return it
          resolve(body.exportLogId);
        }
      });
    })
  };

  /**
   * Download database snapshot from server
   * Database export was already done
   * @param exportLogId
   * @returns {Promise}
   */
  this.getExportedDatabaseSnapshot = function (exportLogId) {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'exported-database-snapshot/' + exportLogId
    });

    // get path for saving the DB; will be saved in system tmp directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;
    let dbSnapshotFileName = `${tmpDirName}/db_snapshot_${this.upstreamServerName}_${Date.now()}.tar.gz`;

    return new Promise(function (resolve, reject) {
      request(requestOptions)
        .on('response', function (response) {
          app.logger.debug(response.status);
        })
        .on('error', function (error) {
          reject(error);
        })
        .pipe(fs.createWriteStream(dbSnapshotFileName))
        .on('finish', function() {
          resolve(dbSnapshotFileName);
        })
      ;
    });
  };
};

module.exports = SyncClient;
