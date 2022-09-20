'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const async = require('async');
const Config = require('./../../server/config.json');
const clusterHelpers = require('./../../components/clusterHelpers');

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
        answer: bcrypt.hashSync(item.answer.toLowerCase(), 10)
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
   * Check whether the team assignment concept (geographical restriction on resources) should be applied for user/outbreak combination
   * @param user
   * @param outbreak
   * @returns {*}
   */
  User.helpers.applyGeographicRestrictions = function (user, outbreak) {
    return user.disregardGeographicRestrictions ?
      false :
      outbreak.applyGeographicRestrictions;
  };

  User.cache = {
    // settings
    enabled: _.get(Config, 'caching.user.enabled', false),

    // cache functions
    /**
     * Given a team ID and an array of locations IDs cache team entry
     * @param teamId
     * @param locationsIds
     * @private
     */
    _setTeamLocationsIds: function (teamId, locationsIds) {
      // don't keep data in cache if cache is disabled
      if (!this.enabled) {
        return;
      }

      // set cache entry
      this.teamLocationsIds[teamId] = locationsIds;
    },
    /**
     * Given a user ID and an array of locations IDs cache user entry
     * @param userId
     * @param locationsIds
     * @private
     */
    _setUserLocationsIds: function (userId, locationsIds) {
      // don't keep data in cache if cache is disabled
      if (!this.enabled) {
        return;
      }

      // set cache entry
      this.userLocationsIds[userId] = locationsIds;
    },
    /**
     * Get user allowed locations
     * Empty array means that all locations are allowed; Empty array is returned in the following cases:
     * 1. User is not assigned to a team
     * 2. At least one of the user's teams doesn't have locations assigned
     * @param userId
     * @returns {Promise<unknown>|Promise<unknown>|Promise<T>}
     */
    getUserLocationsIds: function (userId) {
      // get cache
      let userCache = this;

      // check for already cached information
      if (userCache.userLocationsIds[userId]) {
        return Promise.resolve(userCache.userLocationsIds[userId]);
      }

      // get user teams
      return app.models.team
        .rawFind({
          userIds: userId
        }, {
          projection: {
            locationIds: 1
          }
        })
        .then(function (teams) {
          // requested user is not assigned to any team
          if (!teams.length) {
            // user will have access to all data; cache empty array
            userCache._setUserLocationsIds(userId, []);

            return Promise.resolve([]);
          }

          // initialize flag for team without locations
          let teamWithoutLocations = false;

          // loop through the teams to create jobs for getting their allowed locations
          let jobs = [];

          for (let index = 0; index < teams.length; index++) {
            let team = teams[index];

            // check if team locations are not set or the array is empty
            if (!team.locationIds || !team.locationIds.length) {
              // found team without locations
              teamWithoutLocations = true;

              // no need to get locations for other teams
              break;
            }

            // get team locations
            if (userCache.teamLocationsIds[team.id]) {
              // already cached locations
              jobs.push(cb => {
                return cb(null, userCache.teamLocationsIds[team.id]);
              });
            } else {
              // get team locations and cache them
              jobs.push(cb => {
                return app.models.location.cache
                  .getSublocationsIds(team.locationIds)
                  .then(teamLocationsIds => {
                    userCache._setTeamLocationsIds(team.id, teamLocationsIds);

                    return cb(null, teamLocationsIds);
                  })
                  .catch(cb);
              });
            }
          }

          // check if a team without locations was found
          if (teamWithoutLocations) {
            // user will have access to all data; cache empty array
            userCache._setUserLocationsIds(userId, []);

            return Promise.resolve([]);
          }

          // execute jobs to find locations for all teams
          return new Promise((resolve, reject) => {
            return async.parallelLimit(jobs, 10, (err, results) => {
              if (err) {
                return reject(err);
              }

              // construct the result
              let result = [];
              results.forEach(res => {
                result = result.concat(res);
              });
              result = [...new Set(result)];

              // cache found user locations
              userCache._setUserLocationsIds(userId, result);
              return resolve(result);
            });
          });
        });
    },
    /**
     * Reset cache
     * @param {boolean} broadcastedMessage - Flag specifying whether the reset command was sent from another cluster worker
     */
    reset: function (broadcastedMessage = false) {
      // reset all cache properties
      this.userLocationsIds = {};
      this.teamLocationsIds = {};

      if (!broadcastedMessage) {
        clusterHelpers.broadcastMessageToClusterWorkers(clusterHelpers.messageCodes.clearUserCache, app.logger);
      }
    },

    // cache contents
    // map of user ID to assigned locations IDs; empty array means the user has access to all locations
    userLocationsIds: {},
    // map of team ID to assigned locations IDs; empty array means the team has access to all locations
    teamLocationsIds: {}
  };

  /**
   * Get User allowed locations IDs
   * @param context Remoting context from which to get logged in user and outbreak
   * @returns {Promise<unknown>|Promise<T>|Promise<void>}
   */
  User.helpers.getUserAllowedLocationsIds = (context) => {
    let loggedInUser = context.req.authData.user;
    let outbreak = context.instance;

    if (!User.helpers.applyGeographicRestrictions(loggedInUser, outbreak)) {
      // user has no locations restrictions
      return Promise.resolve();
    }

    // get user allowed locations
    return User.cache
      .getUserLocationsIds(loggedInUser.id)
      .then(userAllowedLocationsIds => {
        if (!userAllowedLocationsIds.length) {
          // user has no locations restrictions
          return Promise.resolve();
        }

        // return user allowed locations IDs
        return Promise.resolve(userAllowedLocationsIds);
      });
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
      let paragraph3 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_PARAGRAPH3');
      let paragraph4;
      let paragraph5 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_PARAGRAPH5');
      let paragraph6 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_PARAGRAPH6');
      let paragraph7 = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_PASSWORD_RESET_PARAGRAPH7');

      // it contains the reset password url
      const config = JSON.parse(fs.readFileSync(path.resolve(`${__dirname}/../../server/config.json`)));

      const passwordChangePath = config.passwordChange && config.passwordChange.path ?
        config.passwordChange.path :
        '/account/change-password';
      let userName = `${info.user.firstName} ${info.user.lastName}`;
      let changePassURL = `${config.public.protocol}://${config.public.host}${config.public.port ? ':' + config.public.port : ''}${passwordChangePath}`;

      paragraph1 = _.template(paragraph1, {interpolate: /{{([\s\S]+?)}}/g})({userName: `${userName}`});
      paragraph4 = `${config.public.protocol}://${config.public.host}${config.public.port ? ':' + config.public.port : ''}${config.passwordReset.path}?token=${info.accessToken.id}`;
      paragraph5 = _.template(paragraph5, {interpolate: /{{([\s\S]+?)}}/g})({changePassURL: `<a href="${changePassURL}">${changePassURL}</a>`});

      // load the html email template
      const template = _.template(fs.readFileSync(path.resolve(`${__dirname}/../../server/views/passwordResetEmail.ejs`)));

      // resolve template params
      let resolvedTemplate = template({
        heading: heading,
        paragraph1: paragraph1,
        paragraph2: paragraph2,
        paragraph3: paragraph3,
        paragraph4: paragraph4,
        paragraph5: paragraph5,
        paragraph6: paragraph6,
        paragraph7: paragraph7,
      });

      app.models.Email.send({
        to: info.email,
        from: config.passwordReset.from,
        subject: subject,
        html: resolvedTemplate
      });
    });
  });

  /**
   * Remove data
   */
  User.sanitize = function (userData) {
    delete userData.password;
    delete userData.settings;
    delete userData.roleIds;
  };

  User.referenceDataFieldsToCategoryMap = {
    institutionName: 'LNG_REFERENCE_DATA_CATEGORY_INSTITUTION_NAME'
  };

  User.referenceDataFields = Object.keys(User.referenceDataFieldsToCategoryMap);

  User.arrayProps = {
    roleIds: true,
    outbreakIds: true
  };

  User.foreignKeyResolverMap = {
    'roleIds[]': {
      modelName: 'role',
      useProperty: 'name'
    },
    'outbreakIds[]': {
      modelName: 'outbreak',
      useProperty: 'name'
    },
    'activeOutbreakId': {
      modelName: 'outbreak',
      useProperty: 'name'
    }
  };

  User.fieldLabelsMap = Object.assign({}, User.fieldLabelsMap, {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdOn: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_ON',
    createdAt: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT',
    email: 'LNG_USER_FIELD_LABEL_EMAIL',
    firstName: 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    lastName: 'LNG_USER_FIELD_LABEL_LAST_NAME',
    languageId: 'LNG_LAYOUT_LANGUAGE_LABEL',
    password: 'LNG_COMMON_FIELD_LABEL_PASSWORD',
    activeOutbreakId: 'LNG_USER_FIELD_LABEL_ACTIVE_OUTBREAK',
    institutionName: 'LNG_USER_FIELD_LABEL_INSTITUTION_NAME',
    telephoneNumbers: 'LNG_USER_FIELD_LABEL_TELEPHONE_NUMBERS',
    'telephoneNumbers.LNG_USER_FIELD_LABEL_PRIMARY_TELEPHONE': 'LNG_USER_FIELD_LABEL_PRIMARY_TELEPHONE',
    'roleIds[]': 'LNG_USER_FIELD_LABEL_ROLES',
    'outbreakIds[]': 'LNG_USER_FIELD_LABEL_AVAILABLE_OUTBREAKS',
    disregardGeographicRestrictions: 'LNG_USER_FIELD_LABEL_DISREGARD_GEOGRAPHIC_RESTRICTIONS'
  });
};
