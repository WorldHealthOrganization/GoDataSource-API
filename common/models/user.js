'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const config = require('../../server/config.json');

module.exports = function (User) {
  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');
  // disable access to location
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'location');
  // disable access to role
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'role');
  // disable email verification, confirm endpoints
  app.utils.remote.disableRemoteMethods(User, ['prototype.verify', 'confirm']);

  /**
   * User cannot change its own role or location
   */
  User.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.instance.id === context.req.authData.user.id) {
      delete context.args.data.roleId;
      delete context.args.data.locationId;
    }
    next();
  });

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
