'use strict';

const session = require('express-session');
let appSessionConfig = require('../config').session;
const uuid = require('uuid').v4;

/**
 * Attach session functionality to express app
 */
module.exports = function (app) {
  // set default data if config not found
  appSessionConfig = appSessionConfig || {};
  appSessionConfig.appSId = appSessionConfig.appSId || 'GoData';
  appSessionConfig.secret = appSessionConfig.secret || uuid();

  // enable session variables
  app.use(session({
    name: appSessionConfig.appSId,
    secret: appSessionConfig.secret,
    resave: true,
    saveUninitialized: true,

    // this store and un-secure should be enough for storing captcha information into session variables
    // but if we need sessions for other things we should consider using a different sore like MongoStore which will be persistent
    store: new session.MemoryStore(),
    cookie: { secure: false }
  }));
};
