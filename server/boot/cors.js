'use strict';

const cors = require('cors');

module.exports = function (app) {
  const corsOptions = {
    origin: '*',
    credentials: true
  };
  if (app.settings.cors && app.settings.cors.enabled) {
    corsOptions.origin = function (origin, callback) {
      // !origin allow server-to-server requests
      if ((app.settings.cors.whitelist || []).indexOf(origin) !== -1 || !origin) {
        return callback(null, true);
      } else {
        return callback(new Error('Not allowed by CORS'));
      }
    };
  }
  app.middleware('initial', cors(corsOptions));
};
