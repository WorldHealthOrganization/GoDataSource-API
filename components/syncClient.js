'use strict';

const got = require('got');
const FormData = require('form-data');
const fs = require('fs');
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
    prefixUrl: normalizeURL(upstreamServer.url),
    username: upstreamServer.credentials.clientId,
    password: upstreamServer.credentials.clientSecret,
    timeout: upstreamServer.timeout != 0 ? upstreamServer.timeout : undefined
  };

  // keep upstream server information for future use
  this.upstreamServerName = upstreamServer.name;
  this.upstreamServerURL = upstreamServer.url;
  this.syncLogEntry = syncLogEntry;

  /**
   * Send request to server
   * @param url
   * @param requestOptions
   * @param callback
   */
  this.sendRequest = function (url, requestOptions, callback) {
    // log request
    app.logger.debug(`Sync ${this.syncLogEntry.id}: Sent request to upstream server: ${requestOptions.method} /${url}${requestOptions.qs ? '?' + JSON.stringify(requestOptions.qs) : ''}`);

    // send request
    // return request(requestOptions, callback);
    got(url, requestOptions)
      .then(response => {
        callback(null, response, response.body);
      })
      .catch(callback);
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
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get the available outbreaks IDs
      that.sendRequest('sync/available-outbreaks', requestOptions, function (error, response, body) {
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
   * @param autoEncrypt
   * @returns {Promise}
   */
  this.sendDBSnapshotForImport = function (DBSnapshotFileName, asynchronous, autoEncrypt) {
    const form = new FormData();
    form.append('snapshot', fs.createReadStream(DBSnapshotFileName));
    form.append('asynchronous', asynchronous);
    form.append('autoEncrypt', autoEncrypt);
    let requestOptions = Object.assign({}, this.options, {
      method: 'POST',
      body: form
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest('sync/import-database-snapshot', requestOptions, function (error, response, body) {
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
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      that.sendRequest('sync-logs/' + syncLogId, requestOptions, function (error, response, body) {
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
   * Get server version
   * @returns {Promise}
   */
  this.getServerVersion = function () {
    let requestOptions = Object.assign({}, this.options, {
      method: 'GET',
      responseType: 'json'
    });

    let that = this;

    return new Promise(function (resolve, reject) {
      // get system version
      that.sendRequest('system-settings/version', requestOptions, function (error, response, body) {
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
