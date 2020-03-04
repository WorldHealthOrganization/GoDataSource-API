'use strict';

const svgCaptcha = require('svg-captcha');
const app = require('../../server/server');

module.exports = function (Captcha) {
  /**
   * Generate SVG
   */
  Captcha.generateSVG = function (forComponent, opts, next) {
    try {
      // generate captcha
      const captcha =
        svgCaptcha.create();

      // keep captcha into session variable
      if (opts.remotingContext.req.session) {
        switch (forComponent) {
          case 'login':
            opts.remotingContext.req.session.loginCaptcha = captcha.text;
            break;
          case 'forgot-password':
            opts.remotingContext.req.session.forgotPasswordCaptcha = captcha.text;
            break;
          case 'reset-password-questions':
            opts.remotingContext.req.session.resetPasswordQuestionsCaptcha = captcha.text;
            break;
        }
      }

      // send response
      next(null, captcha.data);
    } catch (err) {
      app.logger.error(`Failed creating svg captcha; ${err}`);
      next(err);
    }
  };
};
