'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (Device) {

  // Disable create method, devices are created automatically when syncing information
  app.utils.remote.disableRemoteMethods(Device, [
    'create',
    // device history is read-only
    'prototype.__create__history',
    'prototype.__delete__history',
    'prototype.__updateById__history',
    'prototype.__destroyById__history',
  ]);

  /**
   * Wipe Device
   * @param options
   * @param callback
   */
  Device.prototype.wipe = function (options, callback) {
    const device = this;
    // add an entry to the device history
    device.history
      .create({}, options)
      .then(function (historyEntry) {
        // send device wipe request
        return device.sendWipeRequest()
          .catch(function (error) {
            // if it failed, mark request as failed in device history
            return historyEntry
              .updateAttributes({
                status: app.models.deviceHistory.statusList.wipeFailed
              }, options)
              .then(function () {
                throw error;
              });
          });
      })
      .then(function () {
        // if it succeeded, set device status as pending wipe
        return device
          .updateAttributes({
            status: Device.statusList.wipePending
          }, options);
      })
      .then(function () {
        callback();
      })
      .catch(callback);
  };

  /**
   * Mark wipe device request as success
   * @param options
   * @param callback
   * @return {*}
   */
  Device.wipeComplete = function (options, callback) {
    // get device information
    const device = _.get(options, 'remotingContext.req.authData.device');
    // if failed to get device information
    if (!device) {
      // stop with error
      return callback(app.utils.apiError.getError('READ_DEVICE_INFORMATION_FAILURE'));
    }
    // get pending items from device history, ordered from the most recent to the oldest one
    device.history
      .find({
        where: {
          status: app.models.deviceHistory.statusList.wipePending
        },
        order: 'updatedAt DESC'
      })
      .then(function (deviceHistoryList) {
        // keep a list of update history actions
        const updateDeviceHistory = [];
        // go through all device history entries
        deviceHistoryList.forEach(function (deviceHistory, index) {
          // set default wipe status to failed
          let wipeStatus = app.models.deviceHistory.statusList.wipeFailed;
          // mark only the most recent one as success
          if (!index) {
            wipeStatus = app.models.deviceHistory.statusList.wipeSuccess;
          }
          // register update history action
          updateDeviceHistory.push(deviceHistory.updateAttributes({status: wipeStatus}, options));
        });
        // wait for all updates to complete
        return Promise.all(updateDeviceHistory);
      })
      .then(function () {
        // set device status as ready
        return device.updateAttributes({status: Device.statusList.wipeReady}, options);
      })
      .then(function () {
        callback();
      })
      .catch(callback);
  };

  /**
   * Retrieve device data by physical id
   */
  Device.findByPhysicalDeviceId = (physicalDeviceId, callback) => {
    // try and find the device using device id
    app.models.device
      .findOne({
        where: {
          physicalDeviceId: physicalDeviceId
        }
      })
      .then(function (device) {
        callback(null, device);
      })
      .catch(callback);
  };
};
