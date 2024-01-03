'use strict';

// deps
const App = require('../../server/server');
const twoFactorAuthentication = require('./../../components/twoFactorAuthentication');
const localizationHelper = require('../../components/localizationHelper');

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
          errorMessages: 'Missing required parameter: password'
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
        if (user.loginRetriesCount >= 0 && user.bruteForceLoginDate) {
          const bruteForceLoginDate = localizationHelper.toMoment(user.bruteForceLoginDate);
          const now = localizationHelper.now();
          const isValidForReset = bruteForceLoginDate.add(loginSettings.resetTime, loginSettings.resetTimeUnit).isBefore(now);
          const isBanned = user.loginRetriesCount >= loginSettings.maxRetries;
          if (isValidForReset) {
            // reset login retries
            return user.updateAttributes({
              loginRetriesCount: 0,
              bruteForceLoginDate: null
            });
          }
          if (isBanned && !isValidForReset) {
            throw App.utils.apiError.getError('ACTION_TEMPORARILY_BLOCKED');
          }
        }
      })
      .then(() => {
        const loginPayload = {
          email: username,
          password: pw
        };

        // check for two-factor authentication flow
        let twoFactorAuthenticationEnabled = false;
        if (twoFactorAuthentication.isEnabled('oauth')) {
          // add flag to be verified on access token generation
          loginPayload.twoFactorAuthentication = true;
          twoFactorAuthenticationEnabled = true;
        }

        userModel.login(loginPayload, (err, token) => {
          if (err) {
            const now = localizationHelper.now().toDate();
            const userAttributesToUpdate = {};
            if (currentUser.loginRetriesCount >= 0 && currentUser.bruteForceLoginDate) {
              if (currentUser.loginRetriesCount < loginSettings.maxRetries) {
                userAttributesToUpdate.loginRetriesCount = ++currentUser.loginRetriesCount;
                userAttributesToUpdate.bruteForceLoginDate = now;
              }
            } else {
              userAttributesToUpdate.loginRetriesCount = 1;
              userAttributesToUpdate.bruteForceLoginDate = now;
            }

            return currentUser.updateAttributes(userAttributesToUpdate)
              .then(() => next(err))
              .catch(() => next(err));
          }

          currentUser.updateAttributes({
            loginRetriesCount: 0,
            bruteForceLoginDate: null
          }).then(user => {
            if (twoFactorAuthenticationEnabled) {
              return App.models.user.helpers.sendEmail(
                Object.assign(
                  {}, {
                    user: user
                  }, {
                    email: user.email,
                    twoFACode: token.twoFACode
                  }),
                App.models.user.helpers.EmailTemplates.TWO_FACTOR_AUTHENTICATION
              )
                .then(() => {
                  // update response
                  return next(null, twoFactorAuthentication.getStep1Response());
                })
                .catch(next);
            }

            return next(null, {
              token_type: 'bearer',
              expires_in: token.ttl,
              access_token: token.id
            });
          });
        });
      })
      .catch(err => next(err));
  };

  /**
   * Two-factor authentication step 2
   * @param data
   * @param options
   * @param next
   */
  OAuth.twoFactorAuthenticationStep2 = function (data, options, next) {
    twoFactorAuthentication
      .verifyStep2Data(data, options)
      .then(accessToken => {
        return next(null, {
          token_type: 'bearer',
          expires_in: accessToken.ttl,
          access_token: accessToken.id
        });
      })
      .catch(next);
  };
};
