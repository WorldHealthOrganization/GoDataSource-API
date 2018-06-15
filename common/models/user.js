'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const config = require('../../server/config.json');
const bcrypt = require('bcrypt');

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
      const regExp = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).+$/;
      if (password.length < 6 || !(regExp.exec(password))) {
        return callback(app.utils.apiError.getError('INVALID_PASSWORD', {length: 6}));
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
        name: item.question,
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
   * Send password reset email
   */
  User.on('resetPasswordRequest', function (info) {

    const template = _.template(fs.readFileSync(path.resolve(`${__dirname}/../../server/views/passwordResetEmail.ejs`)));
    const url = `${config.public.protocol}://${config.public.host}:${config.public.port}${config.passwordReset.path}`;
    const html = _.template(config.passwordReset.text)({resetHref: `${url}?token=${info.accessToken.id}`});

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
