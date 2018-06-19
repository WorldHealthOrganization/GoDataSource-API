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
    if (context.args.data && context.args.data.categoryId && context.args.data.value) {
      // build a language token based on the available data
      const identifier = ReferenceData.getTranslatableIdentifierForValue(context.args.data.categoryId, context.args.data.value);
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
   * Check if a model is editable before updating it
   */
  ReferenceData.beforeRemote('prototype.updateRecord', function (context, modelInstance, next) {
    ReferenceData.isEntryEditable(modelInstance, function (error, editable) {
      if (error) {
        return next(error);
      }
      // if the record is not editable
      if (!editable) {
        // send back an error
        return next(app.utils.apiError.getError('MODEL_NOT_EDITABLE', {
          model: ReferenceData.modelName,
          id: context.where.id
        }));
      }
      // check if record is in use
      ReferenceData.isRecordInUse(context.where.id, function (error, recordInUse) {
        if (error) {
          return next(error);
        }
        // if the record is in use
        if (recordInUse) {
          // send back an error
          return next(app.utils.apiError.getError('MODEL_IN_USE', {
            model: ReferenceData.modelName,
            id: context.where.id
          }));
        }
        next();
    })
  });


  /**
   * Check if model is editable & model usage before deleting the model
   */
  ReferenceData.observe('before delete', function (context, next) {
    if (context.where.id) {
      ReferenceData.isEntryEditable(context.where.id, function (error, editable) {
        if (error) {
          return next(error);
        }
        // if the record is not editable
        if (!editable) {
          // send back an error
          return next(app.utils.apiError.getError('MODEL_NOT_EDITABLE', {
            model: ReferenceData.modelName,
            id: context.where.id
          }));
        }
        // check if record is in use
        ReferenceData.isRecordInUse(context.where.id, function (error, recordInUse) {
          if (error) {
            return next(error);
          }
          // if the record is in use
          if (recordInUse) {
            // send back an error
            return next(app.utils.apiError.getError('MODEL_IN_USE', {
              model: ReferenceData.modelName,
              id: context.where.id
            }));
          }
          next();
        });
      });
    } else {
      next();
    }
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
   * Update reference record. This actually only updates the icon and translations for value and description
   * @param data
   * @param options
   * @param callback
   */
  ReferenceData.prototype.updateRecord = function (data, options, callback) {
    const self = this;
    const updateActions = [];
    if (data) {
      // if icon was sent
      if (data.icon) {
        // update it
        updateActions.push(
          self.updateAttributes({
            icon: data.icon
          })
        );
      }
      // if the value was sent
      if (data.value) {
        // find the token associated with the value
        updateActions.push(
          app.models.languageToken
            .findOne({
              where: {
                token: self.id,
                languageId: self.languageId
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
        updateActions.push(
          // find the token associated with the value
          app.models.languageToken
            .findOne({
              where: {
                token: self.description,
                languageId: self.languageId
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
      Promise.all(updateActions)
        .then(function () {
          callback(null, self);
        })
        .catch(callback);
    } else {
      callback(null, this);
    }
  };

  /**
   * Get usage for a reference data entry
   * @param filter
   * @param callback
   */
  ReferenceData.prototype.getUsage = function (filter, callback) {
    ReferenceData.findModelUsage(this.id, filter, false, callback);
  };

  /**
   * Count usage for a reference data entry
   * @param where
   * @param callback
   */
  ReferenceData.prototype.countUsage = function (where, callback) {
    ReferenceData.findModelUsage(this.id, {where: where}, true, function (error, results) {
      if (error) {
        return callback(error);
      }
      callback(null,
        // count all of the results
        Object.values(results).reduce(function (a, b) {
          return a + b;
        }));
    });
  };
};
