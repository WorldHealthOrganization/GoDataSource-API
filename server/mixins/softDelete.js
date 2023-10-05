'use strict';

const _ = require('lodash');
const localizationHelper = require('../../components/localizationHelper');

/**
 * Check if a model is monitored for logging
 * @param model
 * @returns {boolean}
 */
function isMonitoredModel(model) {
  return ['auditLog', 'extendedPersistedModel', 'person'].indexOf(model.modelName) === -1;
}

module.exports = function (Model) {

  const deletedFlag = 'deleted';
  const deletedAt = 'deletedAt';

  Model.defineProperty(deletedFlag, {
    type: Boolean,
    required: true,
    default: false,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty(deletedAt, {
    type: Date,
    readOnly: true,
    safeForImport: true
  });

  /**
   * Restore a soft-deleted record
   * @param [options]
   * @param callback
   */
  Model.prototype.undoDelete = function (options, callback) {
    // options is optional
    if (typeof options === 'function' && callback === undefined) {
      callback = options;
      options = {
        options: {}
      };
    }

    // do we need to add update extra properties on restore ?
    let props = {
      [deletedFlag]: false,
      [deletedAt]: null
    };
    if (
      options &&
      options.extraProps
    ) {
      // add extra properties
      Object.assign(
        props,
        options.extraProps
      );
    }

    // make context available for others
    const self = this;
    // build a before/after hook context
    let context = {
      model: Model,
      instance: self,
      where: {
        id: self.id
      },
      options: options
    };
    // notify listeners that a restore operation begins
    Model.notifyObserversOf('before restore', context, function (error) {
      // if error occurred, stop
      if (error) {
        return callback(error);
      }
      // skip model validation
      self.isValid = function (callback) {
        callback(true);
      };
      // restore the instance
      self.updateAttributes(props, options, function (error, result) {
        // if error occurred, stop
        if (error) {
          return callback(error);
        }
        // notify listeners that a restore was completed
        Model.notifyObserversOf('after restore', context, function (error) {
          callback(error, result);
        });
      });
    });
  };

  /**
   * Soft Delete overwrites delete functionality, make sure 'before delete' hooks still work
   */
  Model.observe('before save', function (context, callback) {
    if (isMonitoredModel(Model)) {
      if (context.data) {
        // single record update
        if (context.currentInstance) {
          if (context.data.deleted && context.data.deleted !== context.currentInstance.deleted) {
            _.set(context, `options._instance[${context.currentInstance.id}].softDeleteEvent`, true);
            return Model.notifyObserversOf('before delete', context, callback);
          }
          // batch update
        } else if (context.data.deleted && context.where) {
          _.set(context, `options._instance[batch_${Model.modelName}].softDeleteEvent`, true);
          return Model.notifyObserversOf('before delete', context, callback);
        }
      }
    }
    return callback();
  });

  /**
   * Soft Delete overwrites delete functionality, make sure 'after delete' hooks still work
   */
  Model.observe('after save', function (context, callback) {
    if (isMonitoredModel(Model)) {
      if (
        (
          context.instance &&
          _.get(context, `options._instance[${context.instance.id}].softDeleteEvent`)
        ) ||
        _.get(context, `options._instance[batch_${Model.modelName}].softDeleteEvent`)
      ) {
        return Model.notifyObserversOf('after delete', context, callback);
      }
    }
    return callback();
  });

  /**
   * (internal)Next(step) callback
   * @param error
   * @param result
   * @returns {*}
   */
  function next(error, result) {
    if (typeof this.callback === 'function') {
      return this.callback(error, result);
    }
    if (error) {
      return Promise.reject(error);
    }
    return result;
  }

  /**
   * Overwrite destroyAll with a soft destroyAll
   * @param where
   * @param [options]
   * @param cb
   * @returns {Promise.<T>}
   */
  Model.destroyAll = function softDestroyAll(where, options, cb) {

    if (cb === undefined && typeof options === 'function') {
      cb = options;
    }

    let nextStep = next.bind({callback: cb});

    const promise = Model
      .updateAll(where, {[deletedFlag]: true, [deletedAt]: localizationHelper.now().toDate()})
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });

    // return the promise only when needed
    if (typeof cb !== 'function') {
      return promise;
    }
  };

  // also update aliases for destroyAll
  Model.remove = Model.destroyAll;
  Model.deleteAll = Model.destroyAll;

  /**
   * Overwrite destroyById with a soft destroyById
   * @param id
   * @param options
   * @param cb
   * @returns {Promise.<TResult>}
   */
  Model.destroyById = function softDestroyById(id, options, cb) {
    // initialize flag to know if the function has options sent
    let hasOptions = true;

    if (cb === undefined && typeof options === 'function') {
      cb = options;
      hasOptions = false;
    }

    let nextStep = next.bind({callback: cb});

    const promise = Model
      .findById(id)
      .then(function (instance) {
        if (instance) {
          // skip model validation
          instance.isValid = function (callback) {
            callback(true);
          };

          // initialize props to be updated
          let props = {
            [deletedFlag]: true
          };

          // update the deletedAt property only if the action is not a sync or the property is missing from the instance
          if (!hasOptions || !options._sync || !instance[deletedAt]) {
            props[deletedAt] = localizationHelper.now().toDate();
          }

          return instance
          // sending additional options in order to have access to the remoting context in the next hooks
            .updateAttributes(props, hasOptions ? options : {})
            .then(function () {
              return {count: 1};
            });
        } else {
          return {count: 0};
        }
      })
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });

    // return the promise only when needed
    if (typeof cb !== 'function') {
      return promise;
    }
  };

  // also update aliases for destroyById
  Model.removeById = Model.destroyById;
  Model.deleteById = Model.destroyById;

  /**
   * Overwrite destroy with a soft destroy
   * @param options
   * @param cb
   * @returns {Promise.<TResult>}
   */
  Model.prototype.destroy = function softDestroy(options, cb) {
    // initialize flag to know if the function has options sent
    let hasOptions = true;

    if (cb === undefined && typeof options === 'function') {
      cb = options;
      hasOptions = false;
    } else if (!options) {
      hasOptions = false;
    }

    let nextStep = next.bind({callback: cb});
    // skip model validation
    this.isValid = function (callback) {
      callback(true);
    };

    // initialize properties that need to be updated on delete
    let props = {
      [deletedFlag]: true
    };

    // update the deletedAt property only if the action is not a sync or the property is missing from the instance
    if (!hasOptions || !options._sync || !this[deletedAt]) {
      props[deletedAt] = localizationHelper.now().toDate();
    }

    // do we need to add update extra properties on soft deletion
    if (
      hasOptions &&
      options.extraProps
    ) {
      // add extra properties
      Object.assign(
        props,
        options.extraProps
      );
    }

    const promise = this
    // sending additional options in order to have access to the remoting context in the next hooks
      .updateAttributes(props, hasOptions ? options : {})
      .then(function () {
        return {count: 1};
      })
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });

    // return the promise only when needed
    if (typeof cb !== 'function') {
      return promise;
    }
  };

  // also update aliases for destroy
  Model.prototype.remove = Model.prototype.destroy;
  Model.prototype.delete = Model.prototype.destroy;

  const filterNonDeleted = {
    [deletedFlag]: false
  };

  const _findOrCreate = Model.findOrCreate;
  /**
   * Overwrite findOrCreate to search for non-(soft)deleted records
   * @param filter
   * @param args
   * @returns {*}
   */
  Model.findOrCreate = function findOrCreateDeleted(filter = {}, ...args) {
    if (!filter.where) {
      filter.where = {};
    }
    if (!filter.deleted) {
      filter.where = {and: [filter.where, filterNonDeleted]};
    }
    return _findOrCreate.call(Model, filter, ...args);
  };

  const _find = Model.find;
  /**
   * Overwrite find to search for non-(soft)deleted records
   * @param filter
   * @param args
   * @returns {*}
   */
  Model.find = function findDeleted(filter = {}, ...args) {
    if (!filter.where) {
      filter.where = {};
    }
    if (!filter.deleted) {
      filter.where = {and: [filter.where, filterNonDeleted]};
    }
    return _find.call(Model, filter, ...args);
  };

  const _findOne = Model.findOne;
  /**
   * Overwrite find one method, to search for non-(soft)deleted records
   * @param filter
   * @param args
   * @returns {*}
   */
  Model.findOne = function findOneDeleted(filter = {}, ...args) {
    if (!filter.where) {
      filter.where = {};
    }
    if (!filter.deleted) {
      filter.where = {and: [filter.where, filterNonDeleted]};
    }
    return _findOne.call(Model, filter, ...args);
  };

  const _count = Model.count;
  /**
   * Overwrite count to count non-(soft)deleted records
   * @param where
   * @param args
   * @returns {*}
   */
  Model.count = function countDeleted(where = {}, ...args) {
    const whereStringified = where ? JSON.stringify(where) : '';
    let filterDeleted = whereStringified.indexOf('"deleted":') > -1;

    if (where.includeDeletedRecords) {
      delete where.includeDeletedRecords;
      filterDeleted = true;
    }

    // filter
    const whereNotDeleted = filterDeleted ? where : {and: [where, filterNonDeleted]};
    return _count.call(Model, whereNotDeleted, ...args);
  };


  const _update = Model.update;
  /**
   * Overwrite update/updateAll to update only non-(soft)deleted records
   * @param where
   * @param args
   * @returns {*}
   */
  Model.update = Model.updateAll = function updateDeleted(where = {}, ...args) {
    const whereNotDeleted = {and: [where, filterNonDeleted]};
    return _update.call(Model, whereNotDeleted, ...args);
  };
};
