'use strict';

const app = require('../../server/server');

module.exports = function (SystemSettings) {

  SystemSettings.imageTypes = {
    SVG: 'SVG',
    PNG: 'PNG'
  };

  /**
   * Validate client credentials.clientId uniqueness
   */
  SystemSettings.observe('before save', function (context, callback) {
    // get clients
    let clients = context.instance ? context.instance.clientApplications : context.data.clientApplications;

    // check if clients are set
    if (Array.isArray(clients)) {
      // initialize map of client IDs in order to find duplicates
      let clientIDs = {};
      clients.forEach(function (client) {
        let clientID = client.credentials.clientId;
        if (!clientIDs[clientID]) {
          // initialize counter for client ID
          clientIDs[clientID] = 0;
        }
        clientIDs[clientID]++;
      });

      // get duplicate client IDs
      let duplicateClientIDs = Object.keys(clientIDs).filter(clientID => clientIDs[clientID] > 1);
      if (duplicateClientIDs.length) {
        // duplicate client IDs were found; return validation error
        return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
          errorMessages: `Client IDs must be unique. Duplicate client IDs: ${duplicateClientIDs.join(', ')}`,
          duplicateClientIDs: duplicateClientIDs
        }));
      }
    }

    return callback();
  });
};
