'use strict';

const svgCaptcha = require('svg-captcha');
const app = require('../../server/server');

module.exports = function (Captcha) {
  /**
   * Generate SVG
   */
  Captcha.generateSVG = function (forComponent, opts, next) {
    // fill missing captcha properties
    const captchaConfig = app.utils.helpers.getCaptchaConfig();

    // create captcha
    try {
      // generate captcha
      const captcha = svgCaptcha.create();

      // keep captcha into session variable
      if (opts.remotingContext.req.session) {
        switch (forComponent) {
          case 'login':
            // are we allowed to generate captcha for login ?
            if (!captchaConfig.login) {
              app.logger.error('Failed creating svg captcha; "Login captcha is disabled"');
              return next(app.utils.apiError.getError('DISABLED_CAPTCHA'));
            }

            // generate captcha
            opts.remotingContext.req.session.loginCaptcha = captcha.text;
            break;
          case 'forgot-password':
            // are we allowed to generate captcha for forgot password ?
            if (!captchaConfig.forgotPassword) {
              app.logger.error('Failed creating svg captcha; "Forgot password captcha is disabled"');
              return next(app.utils.apiError.getError('DISABLED_CAPTCHA'));
            }

            // generate captcha
            opts.remotingContext.req.session.forgotPasswordCaptcha = captcha.text;
            break;
          case 'reset-password-questions':
            // are we allowed to generate captcha for reset password questions ?
            if (!captchaConfig.resetPasswordQuestions) {
              app.logger.error('Failed creating svg captcha; "Reset password questions captcha is disabled"');
              return next(app.utils.apiError.getError('DISABLED_CAPTCHA'));
            }

            // generate captcha
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
