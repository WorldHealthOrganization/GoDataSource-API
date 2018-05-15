'use strict';

const app = require('../../server/server');

module.exports = function (ReferenceData) {

  // there is no need to update reference data, only the translations need to be updated
  app.utils.remote.disableRemoteMethods(ReferenceData, [
    'prototype.patchAttributes'
  ]);


  /**
   * Before create hook
   */
  ReferenceData.beforeRemote('create', function (context, modelInstance, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    if (context.args.data && context.args.data.category && context.args.data.value) {
      // build a language token based on the available data
      const identifier = ReferenceData.getTranslatableIdentifierForValue(context.args.data.category, context.args.data.value);
      // also store original values to be used for translations
      context.req._original = {
        value: context.args.data.value,
        description: context.args.data.description,
        languageId: context.args.data.languageId
      };
      // update record data with the language tokens
      context.args.data.id = identifier;
      context.args.data.value = identifier;
      context.args.data.description = `${identifier}_DESCRIPTION`;
    }
    next();
  });


  /**
   * After update hook
   */
  ReferenceData.afterRemote('create', function (context, modelInstance, next) {
    // after successfully creating reference data record, also create translations for it.
    if (context.req._original) {
      // create token for value
      app.models.languageToken
        .create({
          token: modelInstance.id,
          languageId: context.req._original.languageId,
          translation: context.req._original.value
        })
        .then(function () {
          // create token for description
          return app.models.languageToken
            .create({
              token: modelInstance.description,
              languageId: context.req._original.languageId,
              translation: context.req._original.description
            });
        })
        .then(function () {
          next();
        })
        .catch(next);
    } else {
      next();
    }
  });


  /**
   * Expose available categories via API
   * @param callback
   */
  ReferenceData.getAvailableCategories = function (callback) {
    callback(null, ReferenceData.availableCategories);
  };


  /**
   * Update reference record. This actually only updates translations for value and description
   * @param data
   * @param options
   * @param callback
   */
  ReferenceData.prototype.updateRecord = function (data, options, callback) {
    const self = this;
    if (data) {
      const updateLanguageTokens = [];
      // if the value was sent
      if (data.value) {
        // find the token associated with the value
        updateLanguageTokens.push(
          app.models.languageToken
            .findOne({
              where: {
                token: this.id,
                languageId: this.languageId
              }
            })
            .then(function (languageToken) {
              // and update it's translation. Do not handle 'not found' case, it should be internal system error
              return languageToken.updateAttributes({
                translation: data.value
              });
            })
        );
      }
      // if the description was sent
      if (data.description) {
        updateLanguageTokens.push(
          // find the token associated with the value
          app.models.languageToken
            .findOne({
              where: {
                token: this.description,
                languageId: this.languageId
              }
            })
            .then(function (languageToken) {
              // and update it's translation. Do not handle 'not found' case, it should be internal system error
              return languageToken.updateAttributes({
                translation: data.description
              });
            })
        );
      }
      // perform update operations
      Promise.all(updateLanguageTokens)
        .then(function () {
          callback(null, self);
        })
        .catch(callback);
    } else {
      callback(null, this);
    }
  };
};
