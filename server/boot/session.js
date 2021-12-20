'use strict';

const config = require('../config');
const appSessionConfig = config.session || {};
const captchaConfig = config.captcha || {};
const dbName = require('./../datasources').mongoDb.database;

/**
 * Attach session functionality to express app
 */
module.exports = function (app) {
  // we need session functionality only for captcha
  if (
    !captchaConfig.login &&
    !captchaConfig.forgotPassword &&
    !captchaConfig.resetPasswordQuestions
  ) {
    return;
  }

  const session = require('express-session');
  const MongoStore = require('connect-mongo');
  const uuid = require('uuid').v4;
  const MongoDBHelper = require('./../../components/mongoDBHelper');

  // set default data if config not found
  appSessionConfig.appSId = appSessionConfig.appSId || 'GoData';
  appSessionConfig.secret = appSessionConfig.secret || uuid();

  // enable session variables
  app.use(session({
    name: appSessionConfig.appSId,
    secret: appSessionConfig.secret,
    resave: true,
    saveUninitialized: true,
    cookie: {secure: false},
    store: MongoStore.create({
      clientPromise: MongoDBHelper.getMongoDBClient(),
      dbName: dbName,
      ttl: 60 * 15 // 15 minutes
    })
  }));
};
