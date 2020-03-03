const Moment = require('moment');

module.exports = function grantToken(server) {
  server.post('/api/oauth/token', (req, res, next) => {
    req.body = req.body || {};
    const username = req.body.username;
    const pw = req.body.password;

    if (!username) { return next(new Error('Missing required parameter: username', 'invalid_request')); }
    if (!pw) { return next(new Error('Missing required parameter: password', 'invalid_request')); }

    const userModel = server.models.user;
    const loginSettings = server.settings.login;
    let currentUser = null;
    userModel
      .findOne({
        where: {
          email: username
        }
      })
      .then(user => {
        if (!user) {
          throw new Error('Failed to generate token.');
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
            throw new Error('Action is blocked temporarily.');
          }
        }
      })
      .then(() => {
        server.models.user.login({
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

          return res.send({
            token_type: 'bearer',
            expires_in: token.ttl,
            access_token: token.id
          });
        });
      })
      .catch(err => next(err));
  });
};
