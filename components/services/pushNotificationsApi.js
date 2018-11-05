'use strict';

const config = require('../../server/config');
const Parse = require('parse/node');

// initialize Parse client
Parse.initialize(config.pushNotifications.appId, null, config.pushNotifications.masterKey);
Parse.serverURL = config.pushNotifications.serverURL;

/**
 * Build a new notification
 * @param type
 * @param text
 * @constructor
 */
function Notification(type, text) {
  this.type = type;
  this.alert = text;
  this['content-available'] = 1;
}

/**
 * Send a push notification to a deviceId (installationId)
 * @param deviceId
 * @param notification
 * @return {Promise}
 */
function sendNotification(deviceId, notification) {
  // build a parse query
  const query = new Parse.Query(Parse.Installation);
  // query by installation id
  query.equalTo('installationId', deviceId);

  // send push notification
  return Parse.Push.send({
    where: query,
    data: notification
  }, {
    useMasterKey: true
  });
}

/**
 * Push Notification
 * @type {{notification: {wipe: Notification}, sendWipeRequest: (function(*=): Promise)}}
 */
const PushNotification = {

  /**
   * Notification types
   */
  notification: {
    wipe: new Notification('WIPE_REQUEST', 'Go.Data Hub requested device wipe')
  },

  /**
   * Send wipe request notification
   * @param deviceId
   * @return {Promise}
   */
  sendWipeRequest: function (deviceId) {
    return sendNotification(deviceId, this.notification.wipe);
  }
};

module.exports = PushNotification;
