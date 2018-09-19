'use strict';

const request = require('request');
const fs = require('fs');
const tmp = require('tmp');
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
   * Send request to server
   * @param requestOptions
   * @param callback
   */
  this.sendRequest = function (requestOptions, callback) {
    // log request
    app.logger.debug(`Sync ${this.syncLogEntry.id}: Sent request to upstream server: ${requestOptions.method} /${requestOptions.uri}${requestOptions.qs ? '?' + JSON.stringify(requestOptions.qs) : ''}`);

    // send request
    return request(requestOptions, callback);
  };

  /**
   * Check error and response values to figure out if the request succeeded
   * @param error
   * @param response
   * @param expectedStatusCode
   */
  this.getErrorResponse = function (error, response, expectedStatusCode) {
    // set success Status code. Default: 200
    let successStatusCode = expectedStatusCode || 200;

    if (error) {
      // log error
      app.logger.debug(`Sync ${this.syncLogEntry.id}: Error connecting to upstream server`);

      return app.utils.apiError.getError('EXTERNAL_API_CONNECTION_ERROR', {
        serviceName: 'Upstream server',
        error: error
      });
    }

    // log response
    app.logger.debug(`Sync ${this.syncLogEntry.id}: Received response from upstream server. Status code: ${response.statusCode}`);
    if (response.body) {
      app.logger.debug(`Sync ${this.syncLogEntry.id}: Body: ${typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body}`);
    }

    if (response.statusCode !== successStatusCode) {
      return app.utils.apiError.getError('UNEXPECTED_EXTERNAL_API_RESPONSE', {
        serviceName: 'Upstream server',
        error: `Expected status code: ${successStatusCode}. Received: ${response.statusCode}`
      });
    }

    // no error
    return;
  };

  /**
   * Get available outbreaks IDs list
   * @returns {Promise}
   */
  this.getAvailableOutbreaks = function () {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'sync/available-outbreaks',
      json: true
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get the available outbreaks IDs
      that.sendRequest(requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // body contains the outbreakIDs; return them
          resolve(Array.isArray(body.outbreakIDs) ? body.outbreakIDs : []);
        }
      });
    });
  };

  /**
   * Send database to server for import
   * @param DBSnapshotFileName
   * @param asynchronous
   * @returns {Promise}
   */
  this.sendDBSnapshotForImport = function (DBSnapshotFileName, asynchronous) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'POST',
      uri: 'sync/import-database-snapshot',
      formData: {
        snapshot: fs.createReadStream(DBSnapshotFileName),
        asynchronous: asynchronous
      }
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest(requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // parse body to JSON
          try {
            body = JSON.parse(body);
            // body contains the sync log ID; return it
            resolve(body.syncLogId);
          } catch (parseError) {
            reject(app.utils.apiError.getError('UNEXPECTED_EXTERNAL_API_RESPONSE', {
              serviceName: 'Upstream server',
              error: `Response parse error: ${parseError}`
            }));
          }
        }
      });
    });
  };

  /**
   * GET sync log entry for given ID
   * @param syncLogId
   * @returns {Promise}
   */
  this.getSyncLogEntry = function (syncLogId) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'sync-logs/' + syncLogId,
      json: true
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest(requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          resolve(body);
        }
      });
    });
  };

  /**
   * GET export log entry for given ID
   * @param databaseExportLogId
   * @returns {Promise}
   */
  this.getExportLogEntry = function (databaseExportLogId) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'database-export-logs/' + databaseExportLogId,
      json: true
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest(requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          resolve(body);
        }
      });
    });
  };

  /**
   * GET database snapshot from server
   * Database export is done in sync mode
   * @param filter Filter to be sent in the request
   * @returns {Promise}
   */
  this.getDatabaseSnapshot = function (filter) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'sync/database-snapshot',
      qs: {
        filter: JSON.stringify(filter)
      }
    });

    let that = this;

    // get path for saving the DB; will be saved in system tmp directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;
    let dbSnapshotFileName = `${tmpDirName}/db_snapshot_${this.upstreamServerName}_${Date.now()}.zip`;

    return new Promise(function (resolve, reject) {
      that.sendRequest(requestOptions)
        .on('response', function (response) {
          // get error response depending on response status code
          let error = that.getErrorResponse(null, response);

          // if error, reject the promise and don't wait for pipe process to finish
          if (error) {
            return reject(error);
          }
        })
        .on('error', function (error) {
          // get error response
          error = that.getErrorResponse(error);
          reject(error);
        })
        .pipe(fs.createWriteStream(dbSnapshotFileName))
        .on('finish', function () {
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
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'sync/database-snapshot-asynchronous',
      json: true,
      qs: {
        filter: JSON.stringify(filter)
      }
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get the exportLog ID
      that.sendRequest(requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // body contains the databaseExportLogId; return it
          resolve(body.databaseExportLogId);
        }
      });
    });
  };

  /**
   * Download database snapshot from server
   * Database export was already done
   * @param databaseExportLogId Database Export log ID
   * @returns {Promise}
   */
  this.getExportedDatabaseSnapshot = function (databaseExportLogId) {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'sync/exported-database-snapshot/' + databaseExportLogId
    });

    let that = this;

    // get path for saving the DB; will be saved in system tmp directory
    let tmpDir = tmp.dirSync();
    let tmpDirName = tmpDir.name;
    let dbSnapshotFileName = `${tmpDirName}/db_snapshot_${this.upstreamServerName}_${Date.now()}.zip`;

    return new Promise(function (resolve, reject) {
      that.sendRequest(requestOptions)
        .on('response', function (response) {
          // get error response depending on response status code
          let error = that.getErrorResponse(null, response);

          // if error, reject the promise and don't wait for pipe process to finish
          if (error) {
            return reject(error);
          }
        })
        .on('error', function (error) {
          // get error response
          error = that.getErrorResponse(error);
          reject(error);
        })
        .pipe(fs.createWriteStream(dbSnapshotFileName))
        .on('finish', function () {
          resolve(dbSnapshotFileName);
        });
    });
  };

  /**
   * Get server version
   * @returns {Promise}
   */
  this.getServerVersion = function () {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      uri: 'system-settings/version',
      json: true
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get system version
      that.sendRequest(requestOptions, function (error, response, body) {
        // get error response depending on error and response status code
        error = that.getErrorResponse(error, response);

        if (error) {
          return reject(error);
        } else {
          // return response
          resolve(body);
        }
      });
    });
  };
};

module.exports = SyncClient;
