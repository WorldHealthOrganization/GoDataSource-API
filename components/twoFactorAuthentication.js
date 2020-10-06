'use strict';

// dependencies
const app = require('../server/server');
const _ = require('lodash');
const randomize = require('randomatic');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const config = _.get(require('../server/config'), 'login.twoFactorAuthentication', {});
const baseLanguageModel = require('./baseModelOptions/language');

/**
 * Check if 2FA is enabled for the given loginType
 * @param loginType - Accepted value: default, oauth
 * @returns {boolean}
 */
const isEnabled = (loginType = 'default') => {
  let enabled = false;

  if (loginType === 'default') {
    enabled = _.get(config, 'defaultLogin.enabled', false);
  } else if (loginType === 'oauth') {
    enabled = _.get(config, 'oauthLogin.enabled', false);
  }

  return enabled;
};

/**
 * Retrieve 2FA code generation configuration
 * @returns {*|{}}
 */
const getConfig = () => {
  // fill missing config properties
  const codeConfig = config.code || {};
  if (
    !codeConfig.length ||
    isNaN(codeConfig.length)
  ) {
    codeConfig.length = 6;
  }
  if (
    !codeConfig.charset ||
    !codeConfig.charset.length
  ) {
    codeConfig.charset = '0123456789';
  }
  if (
    !codeConfig.ttlMinutes ||
    isNaN(codeConfig.ttlMinutes)
  ) {
    codeConfig.ttlMinutes = 5;
  }

  // finished
  return codeConfig;
};

/**
 * Set 2FA information on access token
 * @param accessToken
 */
const setInfoInAccessToken = (accessToken) => {
  const config = getConfig();

  // update payload
  accessToken.twoFADisabled = true;
  accessToken.twoFACode = randomize('?', config.length, {chars: config.charset});
  accessToken.twoFACodeExpirationDate = moment().add(config.ttlMinutes, 'm').toDate();
};

/**
 * Check if access token is disabled via 2FA logic
 * @param accessToken
 * @returns {boolean}
 */
const isAccessTokenDisabled = (accessToken) => {
  return !!accessToken.twoFADisabled;
};

/**
 * Send 2FA code via email
 * @param user
 * @param accessToken
 * @returns {*}
 */
const sendEmail = (user, accessToken) => {
  return baseLanguageModel.helpers
    .getLanguageDictionary(user.languageId, {
      token: {
        $in: [
          'LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_HEADING',
          'LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_SUBJECT',
          'LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_PARAGRAPH1',
          'LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_PARAGRAPH2'
        ]
      }
    })
    .then(dictionary => {
      // translate email body params
      let heading = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_HEADING');
      let subject = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_SUBJECT');
      let paragraph1 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_PARAGRAPH1');
      let paragraph2 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_TWO_FACTOR_AUTHENTICATION_PARAGRAPH2');

      // load the html email template
      const htmlTemplate = _.template(fs.readFileSync(path.resolve(`${__dirname}/../server/views/twoFactorAuthenticationCodeEmail.ejs`)));

      // resolve template params
      const html = htmlTemplate({
        heading: heading,
        paragraph1: paragraph1,
        paragraph2: paragraph2
      });

      // resolve variables from html
      const emailBody = _.template(html, {interpolate: /{{([\s\S]+?)}}/g})({
        twoFACode: accessToken.twoFACode,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      });

      // resolve variables from subject
      const emailSubject = _.template(subject, {interpolate: /{{([\s\S]+?)}}/g})({
        twoFACode: accessToken.twoFACode,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      });

      return new Promise((resolve, reject) => {
        app.models.Email.send({
          to: user.email,
          from: config.emailFrom,
          subject: emailSubject,
          html: emailBody
        }, err => {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });
    });
};

/**
 * Verify 2FA step 2 data; Returns a promise which resolves with the update access-token if all checks have passed
 * @param data
 * @param options - options from request
 * @returns {Promise<never>|Promise<unknown>}
 */
const verifyStep2Data = (data, options) => {
  // shorter reference for error builder
  const buildError = app.utils.apiError.getError;

  // validation error messages
  let validationErrors = [];

  // make sure email and code are in the request
  if (!data.hasOwnProperty('email')) {
    validationErrors.push('Email is mandatory');
  }
  if (!data.hasOwnProperty('code')) {
    validationErrors.push('Code is mandatory');
  }

  // if there are any validation errors, stop
  if (validationErrors.length) {
    return Promise.reject(buildError('REQUEST_VALIDATION_ERROR', {errorMessages: validationErrors.join()}));
  }

  const email = data.email;
  const code = data.code;

  // cache access-token
  let accessToken;

  return app.models.accessToken
    .findOne({
      where: {
        twoFADisabled: true,
        twoFACode: code,
        twoFACodeExpirationDate: {
          gte: moment().utc().toDate()
        }
      }
    })
    .then(result => {
      if (!result) {
        options.remotingContext.req.logger.debug(`Access-token not found for code '${code}' or code has already expired`);
        return Promise.reject(buildError('AUTHORIZATION_REQUIRED'));
      }

      // access-token found; check if the userId corresponds to the given email
      accessToken = result;
      return app.models.user
        .findOne({
          where: {
            id: accessToken.userId,
            email: email
          }
        });
    })
    .then(user => {
      if (!user) {
        options.remotingContext.req.logger.debug(`Given code '${code}' is not generated for given email '${email}'`);
        return Promise.reject(buildError('AUTHORIZATION_REQUIRED'));
      }

      // code and email combination is valid; update access-token
      return accessToken.updateAttributes({
        twoFADisabled: null,
        twoFACode: null,
        twoFACodeExpirationDate: null
      });
    });
};

/**
 * Create 2FA step 2 response body
 * @returns {{twoFA: boolean}}
 */
const getStep1Response = () => {
  return {
    'twoFA': true
  };
};

module.exports = {
  isEnabled,
  getConfig,
  setInfoInAccessToken,
  isAccessTokenDisabled,
  sendEmail,
  verifyStep2Data,
  getStep1Response
};