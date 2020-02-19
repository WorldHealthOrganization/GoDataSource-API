'use strict';

const assert = require('assert');
const authTokenConfig = require('../../server/config').authToken;

module.exports = function (AccessToken) {
  // set flag to not get controller
  AccessToken.hasController = false;

  // its a copy of the original function signature
  // but instead of destroying expired tokens
  // it refreshes its expiration time using the configured ttl in the user model
  AccessToken.prototype.validate = function(cb) {
    try {
      assert(
        this.created && typeof this.created.getTime === 'function',
        'token.created must be a valid Date'
      );
      assert(this.ttl !== 0, 'token.ttl must be not be 0');
      assert(this.ttl, 'token.ttl must exist');
      assert(this.ttl >= -1, 'token.ttl must be >= -1');

      const AccessToken = this.constructor;
      const userRelation = AccessToken.relations.user; // may not be set up
      let User = userRelation && userRelation.modelTo;

      // redefine user model if accessToken's principalType is available
      if (this.principalType) {
        User = AccessToken.registry.findModel(this.principalType);
        if (!User) {
          process.nextTick(function() {
            return cb(null, false);
          });
        }
      }

      const now = Date.now();
      const created = this.created.getTime();
      const elapsedSeconds = (now - created) / 1000;
      const secondsToLive = this.ttl;
      const eternalTokensAllowed = !!(User && User.settings.allowEternalTokens);
      const isEternalToken = secondsToLive === -1;
      const isValid = isEternalToken ?
        eternalTokensAllowed :
        elapsedSeconds < secondsToLive;

      if (isValid) {
        // determine if ttl is different
        const isTokenTtlDifferent = !isEternalToken &&
          authTokenConfig &&
          authTokenConfig.ttl &&
          this.ttl !== authTokenConfig.ttl;

        // avoid spams, update once every 5 seconds
        // dont wait for token save, to not throttle request performance
        if (
          elapsedSeconds > 5 ||
          isTokenTtlDifferent
        ) {
          // keep token alive
          this.created = now;

          // check if we need to update auth token ttl to config setting
          if (isTokenTtlDifferent) {
            this.ttl = authTokenConfig.ttl;
          }

          // save token
          this.save();
        }
        process.nextTick(function() {
          cb(null, isValid);
        });
      } else {
        this.destroy(function(err) {
          cb(err, isValid);
        });
      }
    } catch (e) {
      process.nextTick(function() {
        cb(e);
      });
    }
  };
};
