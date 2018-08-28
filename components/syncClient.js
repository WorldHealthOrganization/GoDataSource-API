'use strict';

const request = require('request');
const fs = require('fs');

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
 * @constructor
 */
const SyncClient = function (upstreamServer) {
  // initialize options
  this.options = {
    baseUrl: normalizeURL(upstreamServer.url) + '/sync',
    auth: {
      user: upstreamServer.credentials.clientId,
      pass: upstreamServer.credentials.clientSecret
    },
    timeout: upstreamServer.timeout
  };

  /**
   * Get available outbreaks IDs list
   * @returns {Promise}
   */
  this.getAvailableOutbreaks = function () {
    let requestOptions = Object.assign(this.options, {
      method: 'GET',
      uri: 'available-outbreaks',
      json: true
    });

    return new Promise(function (resolve, reject) {
      // get the available outbreaks IDs
      request(requestOptions, function (error, response, body) {
        if(error) {
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
   * @returns {Promise}
   */
  this.sendDBSnapshotForImport = function (DBSnapshotFileName) {
    let requestOptions = Object.assign(this.options, {
      method: 'POST',
      uri: 'import-database-snapshot',
      formData: {
        snapshot: fs.createReadStream(DBSnapshotFileName),
        asynchronous: true
      }
    });

    return new Promise(function (resolve, reject) {
      // get the available outbreaks IDs
      request(requestOptions, function (error, response, body) {
        if(error) {
          return reject(error);
        } else {


          // body contains the sync log ID; return it
          resolve(body.syncLogId);
        }
      });
    })
  };
};

module.exports = SyncClient;
