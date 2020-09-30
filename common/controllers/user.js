'use strict';

const app = require('../../server/server');
const config = require('../../server/config.json');
// used for encoding security questions
const bcrypt = require('bcrypt');
const async = require('async');
const _ = require('lodash');
const Moment = require('moment');
const uuid = require('uuid');
const twoFactorAuthentication = require('./../../components/twoFactorAuthentication');

module.exports = function (User) {

  // get model helpers
  const helpers = User.helpers;

  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');
  // disable access to role
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'role');
  // disable access to active outbreak
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'activeOutbreak');
  // disable email verification, confirm endpoints
  app.utils.remote.disableRemoteMethods(User, ['prototype.verify', 'confirm']);

  User.afterRemote('setPassword', (ctx, modelInstance, next) => {
    User
      .findById(ctx.args.id)
      .then(user => {
        if (!user) {
          return next();
        }
        return user.updateAttributes({
          loginRetriesCount: 0,
          lastLoginDate: null
        }).then(() => next());
      });
  });

  User.observe('before save', (ctx, next) => {
    // do not execute on sync
    if (ctx.options && ctx.options._sync) {
      return next();
    }

    let oldPassword = null;
    if (ctx.data) {
      oldPassword = ctx.data.oldPassword;
      delete ctx.data.oldPassword;
    }

    // do not allow users to reuse old password when changing it and make sure their giving us the old password as well
    if (!ctx.isNewInstance && ctx.data.password) {
      Promise.resolve()
        .then(() => {
          // if this is a reset/change password don't check the old password
          if (
            ctx.options.setPassword ||
            ctx.options.skipOldPasswordCheck || (
              ctx.options.remotingContext &&
              ctx.options.remotingContext.options &&
              ctx.options.remotingContext.options.skipOldPasswordCheck
            )
          ) {
            return;
          }
          if (!oldPassword) {
            throw app.utils.apiError.getError('MISSING_REQUIRED_OLD_PASSWORD');
          }
          return new Promise((resolve, reject) => {
            // check that the old password is a match before trying to change it to a new one
            ctx.currentInstance.hasPassword(oldPassword, (err, isMatch) => {
              if (err) {
                return reject(err);
              }
              if (!isMatch) {
                return reject(app.utils.apiError.getError('INVALID_OLD_PASSWORD'));
              }
              return resolve();
            });
          });
        })
        // check that the old password is not same with the one from request
        .then(() => {
          if (ctx.options.skipSamePasswordCheck || (
            ctx.options.remotingContext &&
            ctx.options.remotingContext.options &&
            ctx.options.remotingContext.options.skipSamePasswordCheck
          )) {
            return;
          }
          return new Promise((resolve, reject) => {
            ctx.currentInstance.hasPassword(ctx.data.password, (err, isMatch) => {
              if (err) {
                return reject(err);
              }
              if (isMatch) {
                return reject(app.utils.apiError.getError('REUSING_PASSWORDS_ERROR'));
              }
              return resolve();
            });
          });
        })
        .then(() => next())
        .catch(err => next(err));
    } else {
      return next();
    }
  });

  /**
   * Hook before user/login method
   */
  User.beforeRemote('login', (ctx, modelInstance, next) => {
    // fill missing captcha properties
    const captchaConfig = app.utils.helpers.getCaptchaConfig();

    // do we need to validate captcha ?
    const req = ctx.req;
    if (
      captchaConfig.login &&
      req.session &&
      req.session.loginCaptcha &&
      req.body &&
      req.session.loginCaptcha !== req.body.captcha
    ) {
      // invalidate captcha - just one time we can use it, otherwise it becomes invalid
      req.session.loginCaptcha = uuid();

      // return invalid captcha
      return next(app.utils.apiError.getError('INVALID_CAPTCHA'));
    }

    // captcha okay
    next();
  });

  User.beforeRemote('login', (ctx, modelInstance, next) => {
    User
      .findOne({
        where: {
          email: ctx.args.credentials.email
        }
      })
      .then(user => {
        if (!user) {
          return next();
        }
        if (user.loginRetriesCount >= 0 && user.lastLoginDate) {
          const lastLoginDate = Moment(user.lastLoginDate);
          const now = Moment();
          const isValidForReset = lastLoginDate.add(config.login.resetTime, config.login.resetTimeUnit).isBefore(now);
          const isBanned = user.loginRetriesCount >= config.login.maxRetries;
          if (isValidForReset) {
            // reset login retries
            return user.updateAttributes({
              loginRetriesCount: 0,
              lastLoginDate: null
            }).then(() => next());
          }
          if (isBanned && !isValidForReset) {
            return next(app.utils.apiError.getError('ACTION_TEMPORARILY_BLOCKED'));
          }
        }
        return next();
      });
  });

  /**
   * Two-Factor Authentication checks
   */
  User.beforeRemote('login', (ctx, modelInstance, next) => {
    if (twoFactorAuthentication.isEnabled()) {
      // add flag to be verified on access token generation
      ctx.args.credentials.twoFactorAuthentication = true;
    }

    next();
  });

  User.afterRemote('login', (ctx, instance, next) => {
    User
      .findOne({
        where: {
          id: instance.userId
        }
      })
      .then(user => {
        if (!user) {
          return next();
        }

        return user
          .updateAttributes({
            loginRetriesCount: 0,
            lastLoginDate: null
          })
          .then(() => {
            if (twoFactorAuthentication.isEnabled()) {
              return twoFactorAuthentication.sendEmail(user, instance);
            }

            return Promise.resolve();
          })
          .then(() => {
            return next();
          });
      })
      .catch(next);
  });

  User.afterRemoteError('login', (ctx, next) => {
    if (ctx.args.credentials.email) {
      User
        .findOne({
          where: {
            email: ctx.args.credentials.email
          }
        })
        .then(user => {
          if (!user) {
            return next();
          }

          const now = Moment().toDate();
          const userAttributesToUpdate = {};
          if (user.loginRetriesCount >= 0 && user.lastLoginDate) {
            if (user.loginRetriesCount >= config.login.maxRetries) {
              return next();
            }
            userAttributesToUpdate.loginRetriesCount = ++user.loginRetriesCount;
            userAttributesToUpdate.lastLoginDate = now;
          } else {
            userAttributesToUpdate.loginRetriesCount = 1;
            userAttributesToUpdate.lastLoginDate = now;
          }

          return user.updateAttributes(userAttributesToUpdate).then(() => next());
        });
    } else {
      return next();
    }
  });

  /**
   * Hook before user/reset method
   */
  User.beforeRemote('resetPassword', (ctx, modelInstance, next) => {
    // fill missing captcha properties
    const captchaConfig = app.utils.helpers.getCaptchaConfig();

    // do we need to validate captcha ?
    const req = ctx.req;
    if (
      captchaConfig.forgotPassword &&
      req.session &&
      req.session.forgotPasswordCaptcha &&
      req.body &&
      req.session.forgotPasswordCaptcha !== req.body.captcha
    ) {
      // invalidate captcha - just one time we can use it, otherwise it becomes invalid
      req.session.forgotPasswordCaptcha = uuid();

      // return invalid captcha
      return next(app.utils.apiError.getError('INVALID_CAPTCHA'));
    }

    // captcha okay
    next();
  });

  /**
   * Hook before user/reset-password-with-security-question method
   */
  User.beforeRemote('resetPassWithSecurityQuestion', (ctx, modelInstance, next) => {
    // fill missing captcha properties
    const captchaConfig = app.utils.helpers.getCaptchaConfig();

    // do we need to validate captcha ?
    const req = ctx.req;
    if (
      captchaConfig.resetPasswordQuestions &&
      req.session &&
      req.session.resetPasswordQuestionsCaptcha &&
      req.body &&
      req.session.resetPasswordQuestionsCaptcha !== req.body.captcha
    ) {
      // invalidate captcha - just one time we can use it, otherwise it becomes invalid
      req.session.resetPasswordQuestionsCaptcha = uuid();

      // return invalid captcha
      return next(app.utils.apiError.getError('INVALID_CAPTCHA'));
    }

    // captcha okay
    next();
  });

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
   * Make sure that whenever email appears, in a user related request, it is forced to be lowercase.
   */
  User.beforeRemote('**', function (context, modelInstance, next) {
    if (_.get(context, 'args.data.email')) {
      context.args.data.email = context.args.data.email.toLowerCase();
    }

    // In the login's case, loopback adds the email to the credentials property instead of data
    if (_.get(context, 'args.credentials.email')) {
      context.args.credentials.email = context.args.credentials.email.toLowerCase();
    }

    // In the reset password with email's case, loopback adds the email to the options property instead of data
    if (_.get(context, 'args.options.email')) {
      context.args.options.email = context.args.options.email.toLowerCase();
    }

    next();
  });

  /**
   * User cannot change its own roles +
   * Validate user password
   */
  User.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // cache request body ref
    let reqBody = context.args.data;

    context.options.skipOldPasswordCheck = config.skipOldPasswordForUserModify;

    if (context.instance.id === context.req.authData.user.id) {
      delete reqBody.roleIds;
    }

    // validation checks for password and security questions
    async.series([
      (done) => helpers.validatePassword(reqBody.password, (error) => helpers.collectErrorMessage(error, done)),
      (done) => helpers.validateSecurityQuestions(reqBody.securityQuestions, (error) => helpers.collectErrorMessage(error, done))
    ], (err, errorMessages) => {
      if (err) {
        return next(app.utils.apiError.getError('INTERNAL_ERROR', {error: 'Validation failed '}));
      }

      if (errorMessages) {
        // clear any undesirable values from error message (bugfix for undefined values returned by callbacks)
        errorMessages = errorMessages.filter((e) => e);

        if (errorMessages.length) {
          return next(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {errorMessages: errorMessages.join()}));
        }
      }

      // check if security questions should be encoded
      if (reqBody.securityQuestions) {
        reqBody.securityQuestions = helpers.encryptSecurityQuestions(reqBody.securityQuestions);
      }

      // If the activeOutbreakId is not part of the available outbreakIds, add it to the array (only if the array is not empty)
      if (reqBody.activeOutbreakId) {
        // If the new outbreakIds don't contain the activeOutbreakId
        if (Array.isArray(reqBody.outbreakIds) &&
          reqBody.outbreakIds.length &&
          !reqBody.outbreakIds.includes(reqBody.activeOutbreakId)
        ) {
          return next(app.utils.apiError.getError('ACTIVE_OUTBREAK_NOT_ALLOWED'));
          // Or of the existing data has outbreakIds that don't contain the new activeOutbreakId
        } else if (Array.isArray(context.instance.outbreakIds) &&
          context.instance.outbreakIds.length &&
          !context.instance.outbreakIds.includes(reqBody.activeOutbreakId)
        ) {
          return next(app.utils.apiError.getError('ACTIVE_OUTBREAK_NOT_ALLOWED'));
        }
      }

      return next();
    });
  });

  /**
   * Validate user password
   */
  User.beforeRemote('create', function (context, modelInstance, next) {
    // cache request body ref
    let reqBody = context.args.data;

    // validation checks for password and security questions
    async.series([
      (done) => helpers.validatePassword(reqBody.password, (error) => helpers.collectErrorMessage(error, done)),
      (done) => helpers.validateSecurityQuestions(reqBody.securityQuestions, (error) => helpers.collectErrorMessage(error, done))
    ], (err, errorMessages) => {
      if (err) {
        return next(app.utils.apiError.getError('INTERNAL_ERROR', {error: 'Validation failed '}));
      }

      if (errorMessages) {
        // clear any undesirable values from error message (bugfix for undefined values returned by callbacks)
        errorMessages = errorMessages.filter((e) => e);

        if (errorMessages.length) {
          return next(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {errorMessages: errorMessages.join()}));
        }
      }

      // check if security questions should be encoded
      if (reqBody.securityQuestions) {
        reqBody.securityQuestions = helpers.encryptSecurityQuestions(reqBody.securityQuestions);
      }

      // if the activeOutbreakId is not part of the available outbreakIds stop with error
      if (reqBody.activeOutbreakId) {
        if (Array.isArray(reqBody.outbreakIds) &&
          reqBody.outbreakIds.length &&
          !reqBody.outbreakIds.includes(reqBody.activeOutbreakId)
        ) {
          return next(app.utils.apiError.getError('ACTIVE_OUTBREAK_NOT_ALLOWED'));
        }
      }

      return next();
    });
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

    // validation error messages
    let validationErrors = [];

    // make sure security questions/email are in the request
    if (!data.hasOwnProperty('questions')) {
      validationErrors.push('Security questions are mandatory');
    }
    if (!data.hasOwnProperty('email')) {
      validationErrors.push('Email is mandatory');
    }

    // if there are any validation errors, stop
    if (validationErrors.length) {
      return callback(buildError('REQUEST_VALIDATION_ERROR', {errorMessages: validationErrors.join()}));
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
          app.logger.error('User not found');
          throw buildError('PASSWORD_RECOVERY_FAILED');
        }

        // verify if user has any security questions set, if not stop at once
        if (user.securityQuestions && user.securityQuestions.length) {
          // flag that indicates that each question name is a match on the user data and the answers are correct
          let isValid = false;

          // check user questions against the ones from request body
          for (let i = 0; i < user.securityQuestions.length; i++) {
            let userQuestion = user.securityQuestions[i];

            // position of the user question in the request body
            let questionPos = data.questions.findIndex((q) => q.question === userQuestion.question);

            // if any of the question are not matching, stop
            if (questionPos === -1) {
              isValid = false;
              break;
            }

            // check the answers
            // backwards compatible (case sensitive check)
            isValid = bcrypt.compareSync(data.questions[questionPos].answer.toLowerCase(), userQuestion.answer) ||
              bcrypt.compareSync(data.questions[questionPos].answer, userQuestion.answer);
            if (!isValid) {
              break;
            }
          }

          // generate a password reset token
          if (isValid) {
            return user.createAccessToken(
              {
                email: user.email,
                password: user.password
              },
              {
                ttl: config.passwordReset.ttl,
                scopes: ['reset-password']
              })
              .then((token) => {
                return {
                  token: token.id,
                  ttl: token.ttl
                };
              })
              .catch((err) => {
                app.logger.warn('Failed to generate reset password token', err);
                return buildError('PASSWORD_RECOVERY_FAILED');
              });
          }

          app.logger.warn('Invalid security questions');
          throw buildError('PASSWORD_RECOVERY_FAILED');
        }

        app.logger.warn('Security questions recovery is disabled');
        throw buildError('PASSWORD_RECOVERY_FAILED');
      });
  };

  /**
   * Attach the custom properties
   */
  User.afterRemote('findById', function (context, modelInstance, next) {
    // attach the custom properties
    User.helpers.attachCustomProperties(
      modelInstance,
      next
    );
  });

  /**
   * Attach the custom properties
   */
  User.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // attach the custom properties
    User.helpers.attachCustomProperties(
      modelInstance,
      next
    );
  });

  /**
   * Export filtered cases to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  User.export = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    new Promise((resolve, reject) => {
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
        if (err) {
          return reject(err);
        }
        return resolve(dictionary);
      });
    }).then(dictionary => {
      if (!Array.isArray(anonymizeFields)) {
        anonymizeFields = [];
      }
      if (anonymizeFields.indexOf('password') === -1) {
        anonymizeFields.push('password');
      }
      options.dictionary = dictionary;
      return app.utils.remote.helpers.exportFilteredModelsList(
        app,
        app.models.user,
        {},
        filter,
        exportType,
        'Users List',
        (typeof encryptPassword !== 'string' || !encryptPassword.length) ? null : encryptPassword,
        anonymizeFields,
        options,
        results => Promise.resolve(results),
        callback
      );
    }).catch(callback);
  };

  User.import = function (data, options, callback) {
    options._sync = false;

    app.models.importableFile.getTemporaryFileById(data.fileId, (err, fileData) => {
      if (err) {
        return callback(err);
      }
      try {
        const rawUsersList = JSON.parse(fileData);
        const usersList = app.utils.helpers.convertBooleanProperties(
          app.models.user,
          app.utils.helpers.remapProperties(rawUsersList, data.map, data.valuesMap));

        const asyncOps = [];
        const asyncOpsErrors = [];

        asyncOpsErrors.toString = function () {
          return JSON.stringify(this);
        };

        // role, outbreak name <-> id mappings
        const resourceMaps = {};

        let roleNames = [];
        let outbreakNames = [];
        usersList.forEach(user => {
          roleNames.push(...user.roleIds);
          outbreakNames.push(...user.outbreakIds.concat([user.activeOutbreakId]));
        });
        roleNames = [...new Set(roleNames)];
        outbreakNames = [...new Set(outbreakNames)];

        return Promise.all([
          new Promise((resolve, reject) => {
            const rolesMap = {};
            app.models.role
              .rawFind({
                name: {
                  inq: roleNames
                }
              })
              .then(roles => {
                roles.forEach(role => {
                  rolesMap[role.name] = role.id;
                });
                resourceMaps.roles = rolesMap;
                return resolve();
              })
              .catch(reject);
          }),
          new Promise((resolve, reject) => {
            const outbreaksMap = {};
            app.models.outbreak
              .rawFind({
                name: {
                  inq: outbreakNames
                }
              })
              .then(outbreaks => {
                outbreaks.forEach(outbreak => {
                  outbreaksMap[outbreak.name] = outbreak.id;
                });
                resourceMaps.outbreaks = outbreaksMap;
                return resolve();
              })
              .catch(reject);
          })
        ]).then(() => {
          usersList.forEach((user, index) => {
            asyncOps.push(cb => {
              user.roleIds = user.roleIds.map(roleName => {
                return resourceMaps.roles[roleName] || roleName;
              });
              user.outbreakIds = user.outbreakIds.map(outbreakName => {
                return resourceMaps.outbreaks[outbreakName] || outbreakName;
              });
              user.activeOutbreakId = resourceMaps.outbreaks[user.activeOutbreakId] || user.activeOutbreakId;

              return app.utils.dbSync.syncRecord(
                options.remotingContext.req.logger,
                app.models.user,
                user,
                options)
                .then(result => cb(null, result.record))
                .catch(err => {
                  // on error, store the error, but don't stop, continue with other items
                  asyncOpsErrors.push({
                    message: `Failed to import user ${index + 1}`,
                    error: err,
                    recordNo: index + 1,
                    data: {
                      file: rawUsersList[index],
                      save: user
                    }
                  });
                  return cb(null, null);
                });
            });
          });

          async.parallelLimit(asyncOps, 10, (err, results) => {
            if (err) {
              return callback(err);
            }
            // if import errors were found
            if (asyncOpsErrors.length) {
              // remove results that failed to be added
              results = results.filter(result => result !== null);
              // overload toString function to be used by error handler
              results.toString = function () {
                return JSON.stringify(this);
              };
              // return error with partial success
              return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                model: app.models.user.modelName,
                failed: asyncOpsErrors,
                success: results
              }));
            }
            // send the result
            return callback(null, results);
          });
        });
      } catch (error) {
        // handle parse error
        callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
          contentType: 'JSON',
          details: error.message
        }));
      }
    });
  };
};
