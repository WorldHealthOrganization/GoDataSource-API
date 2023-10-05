'use strict';

// dependencies
const app = require('../server/server');
const _ = require('lodash');
const randomize = require('randomatic');
const config = _.get(require('../server/config'), 'login.twoFactorAuthentication', {});
const localizationHelper = require('./localizationHelper');

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
  accessToken.twoFACodeExpirationDate = localizationHelper.now().add(config.ttlMinutes, 'm').toDate();
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
  } else {
    // make sure that code is a string to prevent a MongoDB injection
    if (typeof data.code !== 'string') {
      validationErrors.push('Code must be a string');
    }
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
          gte: localizationHelper.now().toDate()
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
  verifyStep2Data,
  getStep1Response
};
