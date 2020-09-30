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
}

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
  accessToken.disabled = true;
  accessToken.twoFACode = randomize('?', config.length, {chars: config.charset});
  accessToken.twoFACodeExpirationDate = moment().add(config.ttlMinutes, 'm').toDate();
}

const verifyInfoFromAccessToken = (accessToken) => {
};

/**
 * Check if access token is disabled via 2FA logic
 * @param accessToken
 * @returns {boolean}
 */
const isAccessTokenDisabled = (accessToken) => {
  return !!accessToken.disabled;
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

module.exports = {
  isEnabled,
  getConfig,
  setInfoInAccessToken,
  isAccessTokenDisabled,
  sendEmail
};
