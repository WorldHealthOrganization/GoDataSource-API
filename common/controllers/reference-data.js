'use strict';

const app = require('../../server/server');
const referenceDataParser = require('./../../components/referenceDataParser');

module.exports = function (ReferenceData) {

  /**
   * Before create hook
   */
  ReferenceData.beforeRemote('create', function (context, modelInstance, next) {
    // parse referenceData to create language tokens
    referenceDataParser.beforeCreateHook(context, modelInstance, next);
  });

  /**
   * Check if model is editable & model usage before deleting the model
   */
  ReferenceData.observe('before delete', function (context, next) {
    if (context.where.id) {
      // if its not editable, it will send an error to the callback
      ReferenceData.isEntryEditable(context.where.id, next);
    } else {
      next();
    }
  });

  /**
   * After update hook
   */
  ReferenceData.afterRemote('create', function (context, modelInstance, next) {
    // after successfully creating reference data, also create translations for it.
    referenceDataParser.afterCreateHook(context, modelInstance, next);
  });

  /**
   * Before update reference data hook
   */
  ReferenceData.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // if its not editable, it will send an error to the callback
    ReferenceData.isEntryEditable(context.instance, next);
    //TODO
    // parse referenceData to update language tokens
    referenceDataParser.beforeUpdateHook(context, modelInstance, next);
  });

  /**
   * After update reference data hook
   */
  ReferenceData.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // after successfully updating reference data, also update translations for it.
    referenceDataParser.afterUpdateHook(context, modelInstance, next);
  });

  /**
   * Expose available categories via API
   * @param callback
   */
  ReferenceData.getAvailableCategories = function (callback) {
    callback(null, ReferenceData.availableCategories);
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
