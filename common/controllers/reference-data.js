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
    ReferenceData.isEntryEditable(context.instance, function (error) {
      // if the error says the instance is not editable
      if (error && ['MODEL_NOT_EDITABLE', 'MODEL_IN_USE'].indexOf(error.code) !== -1) {
        // and if data was sent
        if (context.args.data) {
          // allow customizing some safe properties
          const customizableProperties = ['iconId', 'colorCode'];
          const data = {};
          // exclude all unsafe properties from request
          Object.keys(context.args.data).forEach(function (property) {
            if (customizableProperties.indexOf(property) !== -1) {
              data[property] = context.args.data[property];
            }
          });
          context.args.data = data;
        }
      } else {
        // unhandled error
        return next(error);
      }
      // parse referenceData to update language tokens
      referenceDataParser.beforeUpdateHook(context, modelInstance, next);
    });
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
