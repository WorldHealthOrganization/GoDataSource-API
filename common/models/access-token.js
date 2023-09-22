'use strict';

const assert = require('assert');
const authTokenConfig = require('../../server/config').authToken;
const twoFactorAuthentication = require('./../../components/twoFactorAuthentication');
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (AccessToken) {
  // set flag to not get controller
  AccessToken.hasController = false;

  AccessToken.observe('after save', (ctx, next) => {
    // delete old access tokens for this user
    if (ctx.isNewInstance) {
      AccessToken.remove({
        userId: ctx.instance.userId,
        id: {
          neq: ctx.instance.id
        }
      });
    }
    return next();
  });

  // its a copy of the original function signature
  // but instead of destroying expired tokens
  // it refreshes its expiration time using the configured ttl in the user model
  AccessToken.prototype.validate = function (cb) {
    try {
      assert(
        this.created && typeof this.created.getTime === 'function',
        'token.created must be a valid Date'
      );
      assert(this.ttl !== 0, 'token.ttl must be not be 0');
      assert(this.ttl, 'token.ttl must exist');
      assert(this.ttl >= -1, 'token.ttl must be >= -1');

      // check for two-factor authentication token
      if (twoFactorAuthentication.isAccessTokenDisabled(this)) {
        return cb(null, false);
      }

      const AccessToken = this.constructor;
      const userRelation = AccessToken.relations.user; // may not be set up
      let User = userRelation && userRelation.modelTo;

      // redefine user model if accessToken's principalType is available
      if (this.principalType) {
        User = AccessToken.registry.findModel(this.principalType);
        if (!User) {
          process.nextTick(function () {
            return cb(null, false);
          });
        }
      }

      const now = localizationHelper.now().toDate();
      const created = this.created.getTime();
      const elapsedSeconds = (now - created) / 1000;
      const secondsToLive = this.ttl;
      const eternalTokensAllowed = !!(User && User.settings.allowEternalTokens);
      const isEternalToken = secondsToLive === -1;
      const isValid = isEternalToken ?
        eternalTokensAllowed :
        elapsedSeconds < secondsToLive;

      if (isValid) {
        // avoid spams, update once every 5 seconds
        // dont wait for token save, to not throttle request performance
        if (elapsedSeconds > 5) {
          // keep token alive
          this.created = now;

          // save token
          this.save();
        }
        process.nextTick(function () {
          cb(null, isValid);
        });
      } else {
        this.destroy(function (err) {
          cb(err, isValid);
        });
      }
    } catch (e) {
      process.nextTick(function () {
        cb(e);
      });
    }
  };

  /**
   * Before save hooks
   */
  AccessToken.observe('before save', function (context, next) {
    // check if we need to update auth token ttl to config setting
    const data = context.isNewInstance || !context.data ? context.instance : context.data;
    if (
      data &&
      authTokenConfig &&
      authTokenConfig.ttl &&
      data.ttl !== -1 &&
      data.ttl !== authTokenConfig.ttl
    ) {
      data.ttl = authTokenConfig.ttl;
    }

    if (context.options.twoFactorAuthentication) {
      twoFactorAuthentication.setInfoInAccessToken(data);
    }

    // finished
    next();
  });
};
