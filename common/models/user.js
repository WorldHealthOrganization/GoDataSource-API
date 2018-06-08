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

  /**
   * Validate security questions
   * @param questions
   */
  User.helpers.validateSecurityQuestions = function (questions) {
    // make sure there are 2 questions
    if (!questions || (questions && questions.length !== 2)) {
      return false;
    }

    // make sure that question names are different
    if (questions[0].question.toLowerCase() === questions[1].question.toLowerCase()) {
      return false;
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

    return isValid;
  };

  /**
   * Validate password. It must match a minimum set of requirements
   * @param password
   * @param callback
   */
  User.helpers.validatePassword = function (password, callback) {
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
