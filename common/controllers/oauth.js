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
      return next(app.utils.apiError.getError(
        'REQUEST_VALIDATION_ERROR',
        {
          errorMessages: 'Missing required parameter: username'
        })
      );
    }
    if (!pw) {
      return next(app.utils.apiError.getError(
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
          throw app.utils.apiError.getError('LOGIN_FAILED');
        }
        currentUser = user;
        if (user.loginRetriesCount >= 0 && user.lastLoginDate) {
          const lastLoginDate = Moment(user.lastLoginDate);
          const resetDate = Moment().add(loginSettings.resetTime, loginSettings.resetTimeUnit);
          const isValidForReset = resetDate.diff(lastLoginDate, loginSettings.resetTimeUnit) > loginSettings.resetTime;
          const isBanned = user.loginRetriesCount >= loginSettings.maxRetries;
          if (isValidForReset) {
            // reset login retries
            return user.updateAttributes({
              loginRetriesCount: 0,
              lastLoginDate: null
            });
          }
          if (isBanned && !isValidForReset) {
            throw app.utils.apiError.getError('ACTION_TEMPORARILY_BLOCKED');
          }
        }
      })
      .then(() => {
        userModel.login({
          email: username,
          password: pw
        }, (err, token) => {
          if (err) {
            const userAttributesToUpdate = {};
            if (currentUser.loginRetriesCount >= 0 && currentUser.lastLoginDate) {
              if (currentUser.loginRetriesCount < config.login.maxRetries) {
                userAttributesToUpdate.loginRetriesCount = ++currentUser.loginRetriesCount;
              }
            } else {
              userAttributesToUpdate.loginRetriesCount = 1;
              userAttributesToUpdate.lastLoginDate = Moment().toDate();
            }

            return currentUser.updateAttributes(userAttributesToUpdate)
              .then(() => next(err))
              .catch(() => next(err));
          }

          return next(null, {
            token_type: 'bearer',
            expires_in: token.ttl,
            access_token: token.id
          });
        });
      })
      .catch(err => next(err));
  }
};
