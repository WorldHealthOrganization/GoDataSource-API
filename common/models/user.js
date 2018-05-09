'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const config = require('../../server/config.json');

module.exports = function (User) {
  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');
  // disable access to role
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'role');
  // disable email verification, confirm endpoints
  app.utils.remote.disableRemoteMethods(User, ['prototype.verify', 'confirm']);

  /**
   * Validate password. It must match a minimum set of requirements
   * @param password
   * @param callback
   */
  function validatePassword(password, callback) {
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
  }

  /**
   * Do not allow deletion own user or the last user
   */
  User.beforeRemote('deleteById', function (context, modelInstance, next) {
    if (context.args.id === context.req.authData.user.id) {
      return next(app.utils.apiError.getError('DELETE_OWN_RECORD', {model: 'Role', id: context.args.id}, 403));
    }
    User.count()
      .then(function (userCount) {
        if (userCount < 2) {
          next(app.utils.apiError.getError('DELETE_LAST_USER', {}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * User cannot change its own role or location +
   * Validate user password
   */
  User.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.instance.id === context.req.authData.user.id) {
      delete context.args.data.roleId;
      delete context.args.data.locationId;
    }
    // validate password (if any)
    validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('create', function (context, modelInstance, next) {
    // validate password (if any)
    validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('changePassword', function (context, modelInstance, next) {
    // validate password (if any)
    validatePassword(context.args.newPassword, next);
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

  /**
   * Find geographic restrictions for an user (if any)
   * @param callback (error, false|locations)
   */
  User.prototype.getGeographicRestrictions = function (callback) {
    //  if user has a location restriction
    if (this.locationIds) {
      // find sub-locations for those locations
      app.models.location
        .getSubLocations(this.locationIds, [], callback);
    } else {
      // no locations restrictions
      callback(null, false);
    }
  }
};
