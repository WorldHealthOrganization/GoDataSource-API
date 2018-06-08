'use strict';

const app = require('../../server/server');
const config = require('../../server/config.json');
const bcrypt = require('bcrypt');

module.exports = function (User) {

  // get model helpers
  const helpers = User.helpers;

  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');
  // disable access to role
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'role');
  // disable email verification, confirm endpoints
  app.utils.remote.disableRemoteMethods(User, ['prototype.verify', 'confirm']);

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
    // cache request body ref
    let reqBody = context.args.data;

    if (context.instance.id === context.req.authData.user.id) {
      delete reqBody.roleId;
      delete reqBody.locationIds;
    }

    // check if security questions should be encoded
    if (reqBody.securityQuestions) {
      if (!helpers.validateSecurityQuestions(reqBody.securityQuestions)) {
        return next(true);
      }

      reqBody.securityQuestions = helpers.encryptSecurityQuestions(reqBody.securityQuestions);
    }

    // validate password (if any)
    helpers.validatePassword(reqBody.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('create', function (context, modelInstance, next) {
    // cache request body ref
    let reqBody = context.args.data;

    // check if security questions should be encoded
    if (reqBody.securityQuestions) {
      if (!helpers.validateSecurityQuestions(reqBody.securityQuestions)) {
        return next(app.utils.apiError.getError('INVALID_SECURITY_QUESTIONS'));
      }

      reqBody.securityQuestions = helpers.encryptSecurityQuestions(reqBody.securityQuestions);
    }

    // validate password (if any)
    helpers.validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('changePassword', function (context, modelInstance, next) {
    // validate password (if any)
    helpers.validatePassword(context.args.newPassword, next);
  });

  /**
   * Reset password using security question
   * @param data
   * @param callback
   */
  User.resetPassWithSecurityQuestion = function (data, callback) {
    // shorter reference for error builder
    let buildError = app.utils.apiError.getError;

    // make sure security questions/email are in the request
    if (!data.hasOwnProperty('questions')) {
      return callback(buildError('PASSWORD_RECOVERY_FAILED', { details: 'Security questions are mandatory' }));
    }
    if (!data.hasOwnProperty('email')) {
      return callback(buildError('PASSWORD_RECOVERY_FAILED', { details: 'Email is mandatory' }));
    }

    // search for the user based on the email
    return User
      .findOne({
        where: {
          email: data.email
        }
      })
      .then((user) => {
        if (!user) {
          throw buildError('PASSWORD_RECOVERY_FAILED', { details: 'User not found' });
        }

        // verify if user has any security questions set, if not stop at once
        if (user.securityQuestions && user.securityQuestions.length) {
          // flag that indicates that each question name is a match on the user data and the answers are correct
          let isValid = false;

          // check user questions against the ones from request body
          for (let i = 0; i < user.securityQuestions.length; i++) {
            let userQuestion = user.securityQuestions[i];

            // position of the user question in the request body
            let questionPos = data.questions.findIndex((q) => q.question === userQuestion.name);

            // if any of the question are not matching, stop
            if (questionPos === -1) {
              isValid = false;
              break;
            }

            // check the answers
            isValid = bcrypt.compareSync(data.questions[questionPos].answer, userQuestion.answer);
          }

          // generate a password reset token
          if (isValid) {
              return user
                .createAccessToken(
                  {
                    email: user.email,
                    password: user.password
                  },
                  {
                    ttl: config.passwordReset.ttl, // 15 minutes expiration time
                    scopes: ['reset-password'],
                  }
                )
                .then((token) => {
                  return {
                    token: token.id,
                    ttl: token.ttl
                  };
                })
                .catch(() => buildError('PASSWORD_RECOVERY_FAILED', { details: 'Failed to generate reset password token' }));
          }

          throw buildError('PASSWORD_RECOVERY_FAILED', { details: 'Invalid security questions' });
        }

        throw buildError('PASSWORD_RECOVERY_FAILED', { details: 'Security questions recovery is disabled' });
      });
  };
};
