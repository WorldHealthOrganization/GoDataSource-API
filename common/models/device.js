'use strict';

module.exports = function (Device) {
  Device.statusList = {
    wipeReady: 'LNG_DEVICE_WIPE_STATUS_READY',
    wipePending: 'LNG_DEVICE_WIPE_STATUS_PENDING'
  };

  Device.prototype.sendWipeRequest = function () {
    return Promise.resolve('aaaa');
  };
};
