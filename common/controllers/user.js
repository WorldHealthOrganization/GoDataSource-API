'use strict';

const app = require('../../server/server');
const config = require('../../server/config.json');
// used for encoding security questions
const bcrypt = require('bcrypt');
const async = require('async');
const _ = require('lodash');
const Moment = require('moment');
const uuid = require('uuid').v4;
const twoFactorAuthentication = require('./../../components/twoFactorAuthentication');
const WorkerRunner = require('../../components/workerRunner');
const Platform = require('../../components/platform');
const genericHelpers = require('../../components/helpers');
const importableFile = require('../../components/importableFile');
const Config = require('../../server/config.json');
const exportHelper = require('../../components/exportHelper');

// used in user import
const userImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

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
          lastLoginDate: null,
          resetPasswordRetriesCount: 0,
          lastResetPasswordDate: null
        }).then(() => next());
      });
  });

  User.observe('before save', (ctx, next) => {
    // generate a random password
    const randomPassword = bcrypt.hashSync(app.utils.helpers.randomString('all', 20, 30), 10);

    // check for import action
    if (
      ctx.options &&
      ctx.options.platform === Platform.IMPORT
    ) {
      // force reset password if it's a new user or the password was generated
      if (ctx.isNewInstance) {
        // create user
        if (ctx.instance) {
          ctx.instance.passwordChange = true;
          ctx.instance.forceResetPassword = true;
          if (!ctx.instance.password) {
            ctx.instance.password = randomPassword;
          }
        }
      } else {
        // update user
        if (
          ctx.data &&
          ctx.data.password
        ) {
          ctx.data.passwordChange = true;
          ctx.data.forceResetPassword = true;
        }
      }
    }

    // check for sync action
    if (ctx.options && ctx.options._sync) {
      // on sync from another Go.Data instance we need to import users with same email
      // for this we will add a suffix to the email
      // also to disallow user from being used all roles are removed and password is changed
      if (ctx.options.snapshotFromClient && ctx.isNewInstance) {
        const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(ctx);
        // no roles
        data.target.roleIds = [''];
        // random password
        data.target.password = randomPassword;

        // search for similar email
        return User
          .rawFind({
            '$or': [{
              email: data.target.email
            }, {
              email: {
                '$regex': `^${data.target.email.replace(/[.]/g, '\\.')}`,
                '$options': 'i'
              }
            }]
          }, {projection: {'_id': 1}})
          .then(users => {
            if (!users.length) {
              // no users were found with a similar email; continue create logic
              return;
            }

            // some users were found with a similar email; add suffix to email
            data.target.email += `-duplicate-${users.length}`;
          });
      } else {
        // don't execute additional logic
        return next();
      }
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
          // if this is a reset/change password or it's the import action, don't check the old password
          if (
            ctx.options.setPassword ||
            ctx.options.skipOldPasswordCheck || (
              ctx.options.remotingContext &&
              ctx.options.remotingContext.options &&
              ctx.options.remotingContext.options.skipOldPasswordCheck
            ) ||
              ctx.options.platform === Platform.IMPORT
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

  User.observe('after save', (ctx, next) => {
    // check for import action to send reset email
    if (
      ctx.options &&
      ctx.options.platform === Platform.IMPORT &&
      ctx.instance &&
      ctx.instance.forceResetPassword
    ) {
      // generate a password reset token
      ctx.instance.createAccessToken(
        {
          email: ctx.instance.email,
          password: ctx.instance.password
        },
        {
          ttl: config.passwordReset.ttl,
          scopes: ['reset-password']
        })
        .then((accessToken) => {
          // send email
          app.models.user.sendEmail({
              email: ctx.instance.email,
              user: ctx.instance,
              accessToken: accessToken
            },
            true
          );
        })
        .catch((err) => {
          app.logger.warn('Failed to generate reset password token', err);
        });
    }
    next();
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
      req.session.loginCaptcha.toLowerCase() !== req.body.captcha.toLowerCase()
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
              return twoFactorAuthentication
                .sendEmail(user, instance)
                .then(() => {
                  // update response
                  ctx.result = twoFactorAuthentication.getStep1Response();
                });
            }

            return Promise.resolve();
          })
          .then(() => {
            // no language ?
            if (!user.languageId) {
              return;
            }

            // check if language exits
            return app.models.language
              .findOne({
                where: {
                  id: user.languageId
                }
              })
              .then((language) => {
                // language found ?
                if (language) {
                  return;
                }

                // no language, then reset to english
                user.languageId = 'english_us';
                return user
                  .updateAttributes({
                    languageId: user.languageId
                  });
              });
          })
          .then(() => next());
      })
      .catch(next);
  });

  User.afterRemoteError('login', (ctx, next) => {
    // don't increase user login retries on invalid captcha
    if (ctx.error && ctx.error.code === 'INVALID_CAPTCHA') {
      return next();
    }

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
      req.session.forgotPasswordCaptcha.toLowerCase() !== req.body.captcha.toLowerCase()
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
      req.session.resetPasswordQuestionsCaptcha.toLowerCase() !== req.body.captcha.toLowerCase()
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

    // skip old password checking if feature is disabled or on import
    context.options.skipOldPasswordCheck = config.skipOldPasswordForUserModify ||
      context.options.platform === Platform.IMPORT;

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
        if (
          !user.securityQuestions ||
          !user.securityQuestions.length
        ) {
          app.logger.warn('Security questions recovery is disabled');
          throw buildError('PASSWORD_RECOVERY_FAILED');
        }

        // flag that indicates that each question name is a match on the user data and the answers are correct
        let isValid = false;

        // verify the number of user failed attempts at reset password
        const resetPasswordSettings = config.bruteForce && config.bruteForce.resetPassword ?
          config.bruteForce.resetPassword :
          undefined;

        // define a promise
        let promise = Promise.resolve();
        if (
          resetPasswordSettings &&
          resetPasswordSettings.enabled &&
          user.resetPasswordRetriesCount >= 0 &&
          user.lastResetPasswordDate
        ) {
          // check if then number of failed attempts has been reached
          const lastResetPasswordDate = Moment(user.lastResetPasswordDate);
          const isValidForReset = lastResetPasswordDate.add(resetPasswordSettings.resetTime, resetPasswordSettings.resetTimeUnit).isBefore(Moment());
          if (
            user.resetPasswordRetriesCount >= resetPasswordSettings.maxRetries &&
            !isValidForReset
          ) {
            app.logger.warn('The number of failed attempts at security questions checking has been reached');
            throw buildError('ACTION_TEMPORARILY_BLOCKED');
          }

          // reset the number of failed attempts
          if (isValidForReset) {
            promise = promise
              .then(() => {
                return user.updateAttributes({
                  resetPasswordRetriesCount: 0,
                  lastResetPasswordDate: null
                });
              });
          }
        }

        // return the promise
        return promise
          .then(() => {
            // check user questions against the ones from request body
            for (let i = 0; i < user.securityQuestions.length; i++) {
              let userQuestion = user.securityQuestions[i];

              // position of the user question in the request body
              let questionPos = data.questions.findIndex((q) => q.question === userQuestion.question);

              // if any of the question are not matching, stop
              // check the answers, backwards compatible (case sensitive check)
              isValid = questionPos !== -1 &&
                (
                  bcrypt.compareSync(data.questions[questionPos].answer.toLowerCase(), userQuestion.answer) ||
                  bcrypt.compareSync(data.questions[questionPos].answer, userQuestion.answer)
                );

              // do not continue if at least one answer is invalid
              if (!isValid) {
                break;
              }
            }
          })
          .then(() => {
            // increase the number of failed attempts
            if (
              !isValid &&
              resetPasswordSettings &&
              resetPasswordSettings.enabled
            ) {
              return user.updateAttributes({
                resetPasswordRetriesCount: user.resetPasswordRetriesCount ? ++user.resetPasswordRetriesCount : 1,
                lastResetPasswordDate: Moment().toDate()
              });
            }
          })
          .then(() => {
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
          });
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
   * Export filtered users to file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  User.exportFilteredUsers = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // export
    WorkerRunner.helpers.exportFilteredModelsList(
      {
        collectionName: 'user',
        modelName: app.models.user.modelName,
        scopeQuery: app.models.user.definition.settings.scope,
        arrayProps: app.models.user.arrayProps,
        fieldLabelsMap: app.models.user.fieldLabelsMap,
        exportFieldsOrder: app.models.user.exportFieldsOrder,

        // fields that we need to bring from db, but we might not include in the export (you can still include it since we need it on import)
        // - roleIds, outbreakIds and activeOutbreakId might be included since it is used on import, otherwise we won't have the ability to map this field
        projection: [
          'roleIds',
          'outbreakIds',
          'activeOutbreakId'
        ]
      },
      filter,
      exportType,
      encryptPassword,
      anonymizeFields,
      undefined,
      {
        userId: _.get(options, 'accessToken.userId'),
        questionnaire: undefined,
        useQuestionVariable: false,
        useDbColumns,
        dontTranslateValues,
        jsonReplaceUndefinedWithNull,
        contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
      },
      undefined, {
        roleIds: {
          type: exportHelper.RELATION_TYPE.HAS_MANY,
          collection: 'role',
          project: [
            '_id',
            'name'
          ],
          key: '_id',
          keyValues: `(item) => {
            return item && item.roleIds ?
              item.roleIds :
              undefined;
          }`,
          format: `(item, dontTranslateValues) => {
            return dontTranslateValues ?
              item.id :
              item.name;
          }`
        },
        outbreakIds: {
          type: exportHelper.RELATION_TYPE.HAS_MANY,
          collection: 'outbreak',
          project: [
            '_id',
            'name'
          ],
          key: '_id',
          keyValues: `(item) => {
            return item && item.outbreakIds ?
              item.outbreakIds :
              undefined;
          }`,
          format: `(item, dontTranslateValues) => {
            return dontTranslateValues ?
              item.id :
              item.name;
          }`
        },
        activeOutbreak: {
          type: exportHelper.RELATION_TYPE.HAS_ONE,
          collection: 'outbreak',
          project: [
            '_id',
            'name'
          ],
          key: '_id',
          keyValue: `(item) => {
            return item && item.activeOutbreakId ?
              item.activeOutbreakId :
              undefined;
          }`,
          replace: {
            'activeOutbreakId': {
              value: 'activeOutbreak.name'
            }
          }
        },
        language: {
          type: exportHelper.RELATION_TYPE.HAS_ONE,
          collection: 'language',
          project: [
            '_id',
            'name'
          ],
          key: '_id',
          keyValue: `(item) => {
            return item && item.languageId ?
              item.languageId :
              undefined;
          }`,
          replace: {
            'languageId': {
              value: dontTranslateValues ? 'language._id' :  'language.name'
            }
          }
        }
      })
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
  };

  /**
   * Import an importable file using file ID and a map to remap parameters
   * @param body
   * @param options
   * @param callback
   */
  User.importImportableUsersFileUsingMap = function (body, options, callback) {
    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // treat the sync as a regular operation, not really a sync
    options._sync = false;

    // inject platform identifier
    options.platform = Platform.IMPORT;

    // Create array of actions that will be executed in series/parallel for each batch
    // Note: Failed items need to have success: false and any other data that needs to be saved on error needs to be added in a error container
    const createBatchActions = function (batchData) {
      // build a list of sync operations
      const syncUser = [];

      // get the logged user
      const loggedUser = options &&
      options.remotingContext &&
      options.remotingContext.req &&
      options.remotingContext.req.authData ?
        options.remotingContext.req.authData.user :
        undefined;

      // go through all entries
      batchData.forEach(function (userItem) {
        // ignore the current user to prevent override the password
        if (
          loggedUser &&
          userItem.save && (
            userItem.save.email === loggedUser.email ||
            userItem.save.id === loggedUser.id
          )
        ) {
          return;
        }

        syncUser.push(function (asyncCallback) {
          // sync user
          return app.utils.dbSync.syncRecord(app, logger, app.models.user, userItem.save, options)
            .then(function () {
              asyncCallback();
            })
            .catch(function (error) {
              // on error, store the error, but don't stop, continue with other items
              asyncCallback(null, {
                success: false,
                error: {
                  error: error,
                  data: {
                    file: userItem.raw,
                    save: userItem.save
                  }
                }
              });
            });
        });
      });

      return syncUser;
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.user,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.user,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    let formatterOptions = Object.assign({
      dataType: 'user',
      batchSize: userImportBatchSize,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // retrieve all languages
    app.models.language
      .find({
        _id: true
      })
      .then((languages) => {
        const mappedLanguages = {};
        languages.forEach((language) => {
          mappedLanguages[language.id] = true;
        });

        // send language list to validate the user's language
        formatterOptions.availableLanguages = mappedLanguages;

        // start import
        importableFile.processImportableFileData(app, {
          modelName: app.models.user.modelName,
          logger: logger
        }, formatterOptions, createBatchActions, callback);
      });
  };

  /**
   * Find for filters
   */
  User.findForFilters = function (where, callback) {
    app.models.user
      .find({
        where: where || {},
        fields: {
          id: true,
          firstName: true,
          lastName: true,
          email: true
        },
        order: ['firstName ASC', 'lastName ASC']
      })
      .then((users) => {
        callback(
          null,
          users
        );
      })
      .catch(callback);
  };

  /**
   * Two-factor authentication step 2
   * @param data
   * @param options
   * @param next
   */
  User.twoFactorAuthenticationStep2 = function (data, options, next) {
    twoFactorAuthentication
      .verifyStep2Data(data, options)
      .then(accessToken => {
        return next(null, accessToken);
      })
      .catch(next);
  };
};
