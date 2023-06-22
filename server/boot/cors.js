'use strict';

const cors = require('cors');

module.exports = function (app) {
  const corsOptions = {
    origin: true,
    credentials: true
  };
  if (app.settings.cors && app.settings.cors.enabled) {
    const serverUrl = app.settings.public && app.settings.public.protocol && app.settings.public.host ?
      `${app.settings.public.protocol}://${app.settings.public.host}${app.settings.public.port ? ':' + app.settings.public.port : ''}`.toLowerCase() :
      false;
    corsOptions.origin = function (origin, callback) {
      // !origin allow server-to-server requests
      if (
        !origin || (
          serverUrl &&
          serverUrl === origin.toLowerCase()
        ) ||
        (app.settings.cors.whitelist || []).indexOf(origin) !== -1
      ) {
        return callback(null, true);
      } else {
        return callback(new Error('Not allowed by CORS'));
      }
    };
  }
  app.middleware('initial', cors(corsOptions));
};
