'use strict';

const assert = require('assert');
const authTokenConfig = require('../../server/config').authToken;
const twoFactorAuthentication = require('./../../components/twoFactorAuthentication');
const localizationHelper = require('../../components/localizationHelper');
const app = require('../../server/server');

module.exports = function (AccessToken) {
  // set flag to not get controller
  AccessToken.hasController = false;

  // used to check validity without making request to db if a check was done recently
  // userId => accessTokenId => lastCheckedAndWasValid
  AccessToken.validityCache = {};

  // update user last login date
  AccessToken.updateUserLastLogin = (userId, datetime, next) => {
    // nothing to do ?
    if (!userId) {
      next();
      return;
    }

    // update user last login date - only on new instance
    app.dataSources.mongoDb.connector
      .collection(app.models.user.modelName)
      .findOne(
        {
          _id: userId
        }, {
          projection: {
            _id: 1,
            lastLogin: 1
          }
        }
      )
      .then(function (user) {
        // user not found, continue as if no token was sent
        if (!user) {
          return;
        }

        // no need to update ?
        if (
          user.lastLogin &&
          localizationHelper.toMoment(user.lastLogin).isSame(localizationHelper.toMoment(datetime), 'minute')
        ) {
          return;
        }

        // update user
        // use mongodb to update, so we don't trigger hooks and alter any other fields
        return app.dataSources.mongoDb.connector
          .collection(app.models.user.modelName)
          .updateOne(
            {
              _id: user._id
            }, {
              $set: {
                lastLogin: localizationHelper.toMoment(datetime).toDate(),
              }
            }
          );
      })
      .then(() => {
        next();
      })
      .catch(() => {
        // continue without showing error...
        next();
      });
  };

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

    // cleanup ?
    if (
      ctx.instance &&
      ctx.instance.deleted
    ) {
      // make sure we update next time
      delete AccessToken.validityCache[ctx.instance.userId];

      // finished
      next();
      return;
    }

    // no need to update user last login date ?
    if (
      !ctx.instance ||
      !ctx.instance.userId ||
      !ctx.instance.created ||
      !ctx.isNewInstance || (
        ctx.options &&
        ctx.options.scopes &&
        ctx.options.scopes.length > 0 &&
        ctx.options.scopes.indexOf('reset-password') > -1
      )
    ) {
      next();
      return;
    }

    // update user last login date
    AccessToken.updateUserLastLogin(
      ctx.instance.userId,
      ctx.instance.created,
      next
    );
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
        // avoid spams, update once every 50 seconds
        // don't wait for token save, to not throttle request performance
        // since we receive multiple requests at the same time we shouldn't update token every time
        if (
          elapsedSeconds > 50 &&
          this.userId && (
            !AccessToken.validityCache[this.userId] ||
            !AccessToken.validityCache[this.userId][this.id] ||
            (now - AccessToken.validityCache[this.userId][this.id]) / 1000 > 30
          )
        ) {
          // update validity check, so we don't spam multiple checks for the same request
          AccessToken.validityCache[this.userId] = {
            [this.id]: now.getTime()
          };

          // keep token alive
          this.created = now;

          // save token
          this.save();

          // update user last login date
          AccessToken.updateUserLastLogin(
            this.userId,
            now,
            // no wait
            () => {}
          );
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
