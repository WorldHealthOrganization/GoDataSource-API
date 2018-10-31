'use strict';

const _ = require('lodash');

/**
 * Register/Update device (phone) history
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addAfter('authentication-context', 'device-register')
    .use(function (context, next) {
      // get client Id (if any)
      const clientId = _.get(context, 'req.authData.credentials.clientId');
      // get device info (if any)
      let deviceInfo = _.get(context, 'req.headers.device-info');
      // if there is no client id or no device id
      if (clientId === undefined || deviceInfo === undefined) {
        // stop here
        return next();
      }
      // define device Id
      let deviceId;
      try {
        // try to parse device information
        deviceInfo = JSON.parse(deviceInfo);
        // extract device id
        deviceId = deviceInfo.id;
      } catch (error) {
        // log error and fail
        context.req.logger.error(error);
        next(app.utils.apiError.getError('READ_DEVICE_INFORMATION_FAILURE', {error: error.message}));
      }
      // try and find the device using device id
      app.models.device
        .findOne({
          where: {
            physicalDeviceId: deviceId
          }
        })
        .then(function (device) {
          // if the device was not found
          if (!device) {
            // add it now
            return app.models.device
              .create({
                physicalDeviceId: deviceId,
                os: deviceInfo.os,
                manufacturer: deviceInfo.manufacturer,
                model: deviceInfo.model
              });
          }
          // otherwise update its last seen date
          return device.updateAttributes({
            lastSeen: new Date()
          });
        })
        .then(function (device) {
          // store device in the context for later use
          _.set(context, 'req.authData.device', device);
          // continue when everything is done
          next();
        })
        .catch(function (error) {
          // log error and fail
          context.req.logger.error(error);
          next(app.utils.apiError.getError('SAVE_DEVICE_INFORMATION_FAILURE', {error: error.message}));
        });
    });
};
