'use strict';

const app = require('../../server/server');

module.exports = function (Device) {
  Device.statusList = {
    wipeReady: 'LNG_DEVICE_WIPE_STATUS_READY',
    wipePending: 'LNG_DEVICE_WIPE_STATUS_PENDING'
  };

  /**
   * Send device wipe request
   * @return {*|Promise}
   */
  Device.prototype.sendWipeRequest = function () {
    return app.utils.services.pushNotificationsApi
      .sendWipeRequest(this.physicalDeviceId);
  };
};
