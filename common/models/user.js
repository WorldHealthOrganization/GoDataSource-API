'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const config = require('../../server/config.json');

module.exports = function (User) {
  // set flag to force using the controller
  User.hasController = true;

  // initialize model helpers
  User.helpers = {};

  /**
   * Validate password. It must match a minimum set of requirements
   * @param password
   * @param callback
   */
  User.helpers.validatePassword = function(password, callback) {
    let error;
    if (password) {
      const regExp = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).+$/;
      if (
        password.length < 6 ||
        !(regExp.exec(password))
      ) {
        error = app.utils.apiError.getError('INVALID_PASSWORD', {length: 6});
      }
    }
    callback(error);
  };

  /**
   * Send password reset email
   */
  User.on('resetPasswordRequest', function (info) {

    const template = _.template(fs.readFileSync(path.resolve(`${__dirname}/../../server/views/passwordResetEmail.ejs`)));
    const url = `${config.public.protocol}://${config.public.host}:${config.public.port}${config.passwordReset.path}`;
    const html = _.template(config.passwordReset.text)({resetHref: `${url}?access_token=${info.accessToken.id}`});

    app.models.Email.send({
      to: info.email,
      from: config.passwordReset.from,
      subject: config.passwordReset.subject,
      html: template({
        text: html
      })
    });
  });

};
