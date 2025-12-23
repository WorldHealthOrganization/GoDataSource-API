'use strict';

const app = require('../../server/server');
const uuid = require('uuid');
const _ = require('lodash');

module.exports = function (ClientApplication) {
  /**
   * Download a QR-Code (PNG) file that encodes a clientId/clientSecret
   */
  ClientApplication.prototype.downloadConfigurationFile = function (url, callback) {
    // download configuration
    const apiKey = app.get('apiKey');
    app.utils.remote.helpers
      .offerFileToDownload(app.utils.qrCode.encodeDataInQr({
        clientId: _.get(this, 'credentials.clientId'),
        clientSecret: _.get(this, 'credentials.clientSecret'),
        url: url,
        apiKey:apiKey,
      }), 'image/png', `${uuid.v4()}.png`, callback);
  };
};
