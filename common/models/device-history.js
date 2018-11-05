'use strict';

module.exports = function (DeviceHistory) {

  DeviceHistory.hasController = false;

  DeviceHistory.statusList = {
    wipePending: 'LNG_DEVICE_HISTORY_WIPE_STATUS_PENDING',
    wipeFailed: 'LNG_DEVICE_HISTORY_WIPE_STATUS_FAILED',
    wipeSuccess: 'LNG_DEVICE_HISTORY_WIPE_STATUS_SUCCESS',
  };
};
