'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const Async = require('async');

module.exports = function (User) {
  // set flag to force using the controller
  User.hasController = true;

  // initialize model helpers
  User.helpers = {};

  // define a list of custom (non-loopback-supported) relations
  User.customRelations = {
    roles: {
      type: 'belongsToMany',
      model: 'role',
      foreignKey: 'roleIds'
    }
  };

  /**
   * Override loopback password setter (node_modules/loopback/common/model/user) as the check for already encrypted password is obsolete
   * (Wiki) As of February 2014 bcrypt generates hashes starting with '$2b$' instead of '$2a$'
   * Added additional check for '$2b$' hash start
   * @param plain
   */
  User.setter.password = function (plain) {
    if (typeof plain !== 'string') {
      return;
    }
    if (
      (
        plain.indexOf('$2a$') === 0 ||
        // additional check
        plain.indexOf('$2b$') === 0
      ) && plain.length === 60
    ) {
      // The password is already hashed. It can be the case
      // when the instance is loaded from DB
      this.$password = plain;
    } else {
      this.$password = this.constructor.hashPassword(plain);
    }
  };

  /**
   * Validate security questions
   * @param questions
   * @param callback
   */
  User.helpers.validateSecurityQuestions = function (questions, callback) {
    if (!questions) {
      return callback();
    }
    // generate the generic error for security questions
    let error = app.utils.apiError.getError('INVALID_SECURITY_QUESTIONS');

    // make sure there are 2 questions
    if (!questions || (questions && questions.length !== 2)) {
      return callback(error);
    }

    // make sure that question names are different
    if (questions[0].question.toLowerCase() === questions[1].question.toLowerCase()) {
      return callback(error);
    }

    // make sure that each question has a name and an answer
    // also question names should be different and answers not empty
    let isValid = true;

    questions.forEach((item) => {
      if (!item.answer ||
        (item.answer && (item.answer.length === 0 || !item.answer.trim()))) {
        isValid = false;
      }
    });

    return isValid ? callback() : callback(error);
  };

  /**
   * Validate password. It must match a minimum set of requirements
   * @param password
   * @param callback
   */
  User.helpers.validatePassword = function (password, callback) {
    if (password) {
      if (password.length < 12) {
        return callback(app.utils.apiError.getError('INVALID_PASSWORD', {length: 12}));
      }
    }
    return callback();
  };

  /**
   * Encrypt security questions answers with 10 sals rounds
   * @param questions
   */
  User.helpers.encryptSecurityQuestions = function (questions) {
    return questions.map((item) => {
      return {
        question: item.question,
        answer: bcrypt.hashSync(item.answer, 10)
      };
    });
  };

  /**
   * Collect error message from an api error
   * @param error
   * @param callback
   */
  User.helpers.collectErrorMessage = function (error, callback) {
    if (error) {
      return callback(null, error.message);
    }
    return callback();
  };

  /**
   * Attach custom data to user model
   */
  User.helpers.attachCustomProperties = function (userModel, callback) {
    // available permissions
    userModel.availablePermissions = app.models.role.availablePermissions;

    // finished
    return callback();
  };

  /**
   * Send password reset email
   */
  User.on('resetPasswordRequest', function (info) {
    // load user language dictionary
    app.models.language.getLanguageDictionary(info.user.languageId, function (error, dictionary) {
      if (error) {
        app.logger.error(`Failed to retrieve tokens for the following language: ${info.user.languageId}`);
        return false;
      }

      // translate email body params
      let heading = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_HEADING');
      let subject = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_SUBJECT');
      let paragraph1 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_PARAGRAPH1');
      let paragraph2 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_PARAGRAPH2');

      // second parameter should also be resolved as a template
      // it contains the reset password url
      const config = JSON.parse(fs.readFileSync(path.resolve(`${__dirname}/../../server/config.json`)));
      const url = `${config.public.protocol}://${config.public.host}:${config.public.port}${config.passwordReset.path}`;
      paragraph2 = _.template(paragraph2, {interpolate: /{{([\s\S]+?)}}/g})({resetHref: `${url}?token=${info.accessToken.id}`});

      // load the html email template
      const template = _.template(fs.readFileSync(path.resolve(`${__dirname}/../../server/views/passwordResetEmail.ejs`)));

      // resolve template params
      let resolvedTemplate = template({
        heading: heading,
        paragraph1: paragraph1,
        paragraph2: paragraph2
      });

      app.models.Email.send({
        to: info.email,
        from: config.passwordReset.from,
        subject: subject,
        html: resolvedTemplate
      });
    });
  });

  User.migrate = function (opts, next) {
    const db = app.dataSources.mongoDb.connector;
    return db.connect(() => {
      // sys admin constants
      const ADMIN_ID = 'sys_admin';
      const ADMIN_EMAIL = 'admin@who.int';

      // db collections
      const collections = [
        'helpItem',
        'labResult',
        'databaseActionLog',
        'followUp',
        'user',
        'accessToken',
        'relationship',
        'fileAttachment',
        'helpCategory',
        'deviceHistory',
        'location',
        'filterMapping',
        'language',
        'device',
        'referenceData',
        'team',
        'outbreak',
        'cluster',
        'importMapping',
        'auditLog',
        'person',
        'languageToken',
        'systemSettings',
        'template',
        'backup',
        'role',
        'icon'
      ];

      // make sure we have a sys admin on the system that doesn't have the hardcoded _id
      // we find it by the hardcoded email address admin@who.int
      const userCollection = db.collection('user');
      return userCollection.findOne({
        email: ADMIN_EMAIL,
        _id: {
          $ne: ADMIN_ID
        }
      }, (err, result) => {
        if (err) {
          return next(err);
        }

        // everything is alright, just stop the script
        if (!result) {
          return next();
        }

        // async jobs ran against database
        const updateJobs = [];

        // used to update createdBy, updateBy fields
        const updateAuthorField = function (collectionName, field, callback) {
          return db.collection(collectionName).updateMany(
            {
              [field]: result._id
            },
            {
              $set: {
                [field]: ADMIN_ID
              }
            },
            err => callback(err)
          );
        };

        // update user's id
        updateJobs.push(
          callback => Async.series([
            callback => userCollection.deleteOne({_id: result._id}, err => callback(err)),
            callback => userCollection.insertOne(
              Object.assign({}, result, {_id: ADMIN_ID, oldId: result._id}),
              err => callback(err)
            )
          ], err => callback(err))
        );

        // go through each collection and update author information
        for (let collectionName of collections) {
          updateJobs.push((callback) => {
            return Async.series([
              callback => updateAuthorField(collectionName, 'createdBy', callback),
              callback => updateAuthorField(collectionName, 'updatedBy', callback)
            ], callback);
          });
        }

        // also find all teams where sys admin is a participant
        // update those as well
        updateJobs.push((callback) => {
          return db.collection('team').updateMany(
            {
              userIds: result._id
            },
            {
              $set: {
                'userIds.$': ADMIN_ID
              }
            },
            err => callback(err)
          );
        });

        return Async.series(updateJobs, err => next(err));
      });
    });
  };
};
