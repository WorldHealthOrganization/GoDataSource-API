'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (ClientApplication) {

  /**
   * Validate client id
   */
  function validateClientId(context) {
    // promisify action
    return new Promise(function (resolve, reject) {
      // new instance
      if (context.isNewInstance) {
        // get client ID
        let clientId = _.get(context, 'instance.credentials.clientId');
        // check if client ID is present before validating
        if (clientId == null) {
          resolve();
        } else {
          // check if there is another client application having the same client ID
          ClientApplication
            .count({
              'credentials.clientId': clientId
            })
            .then(function (clients) {
              // if another application has the same client ID
              if (clients) {
                // throw an error
                throw app.utils.apiError.getError('MODEL_PROPERTY_CONFLICT', {
                  propertyName: 'credentials.clientId',
                  propertyValue: clientId
                });
              }
              // otherwise just continue
              resolve();
            })
            .catch(reject);
        }
      } else {
        // existing instance, get both client ID and instance ID
        let clientId = _.get(context, 'data.credentials.clientId');
        let instanceId = _.get(context, 'currentInstance.id');
        // check if client ID is present before validating
        if (clientId == null) {
          resolve();
        } else {
          // check if there is another client application having the same client ID
          ClientApplication
            .count({
              id: {
                neq: instanceId
              },
              'credentials.clientId': clientId,
            })
            .then(function (clients) {
              // if another application has the same client ID
              if (clients) {
                // throw an error
                throw app.utils.apiError.getError('MODEL_PROPERTY_CONFLICT', {
                  propertyName: 'credentials.clientId',
                  propertyValue: clientId
                });
              }
              // otherwise just continue
              resolve();
            })
            .catch(reject);
        }
      }
    });
  }

  /**
   * Before save hooks
   */
  ClientApplication.observe('before save', function (context, next) {
    validateClientId(context)
      .then(function () {
        next();
      })
      .catch(next);
  });
};
