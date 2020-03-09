'use strict';

// deps
const App = require('../../server/server');
const Moment = require('moment');

module.exports = function (OAuth) {
  OAuth.createToken = function (data, opts, next) {
    data = data || {};
    const username = data.username;
    const pw = data.password;

    if (!username) {
      return next(App.utils.apiError.getError(
        'REQUEST_VALIDATION_ERROR',
        {
          errorMessages: 'Missing required parameter: username'
        })
      );
    }
    if (!pw) {
      return next(App.utils.apiError.getError(
        'REQUEST_VALIDATION_ERROR',
        {
          errorMessages: 'Missing required parameter: pasword'
        })
      );
    }

    const userModel = App.models.user;
    const loginSettings = App.settings.login;
    let currentUser = null;
    userModel
      .findOne({
        where: {
          email: username
        }
      })
      .then(user => {
        if (!user) {
          throw App.utils.apiError.getError('LOGIN_FAILED');
        }
        currentUser = user;
        if (user.loginRetriesCount >= 0 && user.lastLoginDate) {
          const lastLoginDate = Moment(user.lastLoginDate);
          const now = Moment();
          const isValidForReset = lastLoginDate.add(loginSettings.resetTime, loginSettings.resetTimeUnit).isBefore(now);
          const isBanned = user.loginRetriesCount >= loginSettings.maxRetries;
          if (isValidForReset) {
            // reset login retries
            return user.updateAttributes({
              loginRetriesCount: 0,
              lastLoginDate: null
            });
          }
          if (isBanned && !isValidForReset) {
            throw App.utils.apiError.getError('ACTION_TEMPORARILY_BLOCKED');
          }
        }
      })
      .then(() => {
        userModel.login({
          email: username,
          password: pw
        }, (err, token) => {
          if (err) {
            const now = Moment().toDate();
            const userAttributesToUpdate = {};
            if (currentUser.loginRetriesCount >= 0 && currentUser.lastLoginDate) {
              if (currentUser.loginRetriesCount < loginSettings.maxRetries) {
                userAttributesToUpdate.loginRetriesCount = ++currentUser.loginRetriesCount;
                userAttributesToUpdate.lastLoginDate = now;
              }
            } else {
              userAttributesToUpdate.loginRetriesCount = 1;
              userAttributesToUpdate.lastLoginDate = now;
            }

            return currentUser.updateAttributes(userAttributesToUpdate)
              .then(() => next(err))
              .catch(() => next(err));
          }

          currentUser.updateAttributes({
            loginRetriesCount: 0,
            lastLoginDate: null
          }).then(() => next(null, {
            token_type: 'bearer',
            expires_in: token.ttl,
            access_token: token.id
          }));
        });
      })
      .catch(err => next(err));
  };
};
