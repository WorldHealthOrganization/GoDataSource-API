'use strict';

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
    readOnly: true
  });

  Model.defineProperty(deletedAt, {
    type: Date,
    readOnly: true
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
      options = {};
    }
    // make context available for others
    const self = this;
    // build a before/after hook context
    let context = Object.assign({}, options, {
      model: Model,
      instance: self,
      where: {
        id: self.id
      }
    });
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
      self.updateAttributes({[deletedFlag]: false, [deletedAt]: null}, function (error, result) {
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
            context.options.softDeleteEvent = true;
            return Model.notifyObserversOf('before delete', context, callback);
          }
          // batch update
        } else if (context.data.deleted && context.where) {
          context.options.softDeleteEvent = true;
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
      if (context.options.softDeleteEvent) {
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
      .updateAll(where, {[deletedFlag]: true, [deletedAt]: new Date()})
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });

    // return the promise only when needed
    if (typeof cb !== "function") {
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
          return instance
          // sending additional options in order to have access to the remoting context in the next hooks
            .updateAttributes({[deletedFlag]: true, [deletedAt]: new Date()}, hasOptions ? options : {})
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
    if (typeof cb !== "function") {
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
    }

    let nextStep = next.bind({callback: cb});
    // skip model validation
    this.isValid = function (callback) {
      callback(true);
    };
    const promise = this
    // sending additional options in order to have access to the remoting context in the next hooks
      .updateAttributes({[deletedFlag]: true, [deletedAt]: new Date()}, hasOptions ? options : {})
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
    if (typeof cb !== "function") {
      return promise;
    }
  };

  // also update aliases for destroy
  Model.prototype.remove = Model.prototype.destroy;
  Model.prototype.delete = Model.prototype.destroy;

  const filterNonDeleted = {
    [deletedFlag]: {
      neq: true
    }
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
    const whereNotDeleted = {and: [where, filterNonDeleted]};
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
