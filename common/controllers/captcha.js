'use strict';

const svgCaptcha = require('svg-captcha');
const app = require('../../server/server');

module.exports = function (Captcha) {
  /**
   * Generate SVG
   */
  Captcha.generateSVG = function (opts, next) {
    try {
      // generate captcha
      const captcha = svgCaptcha.create();

      // keep captcha into session variable
      if (opts.remotingContext.req.session) {
        opts.remotingContext.req.session.captcha = captcha.text;
      }

      // send response
      next(null, captcha.data);
    } catch (err) {
      app.logger.error(`Failed creating svg captcha; ${err}`);
      next(err);
    }
  };
};
