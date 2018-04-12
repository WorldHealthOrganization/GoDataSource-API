'use strict';

/**
 * Check if a model is monitored for logging
 * @param model
 * @returns {boolean}
 */
function isMonitoredModel(model) {
  return ['auditLog', 'extendedPersistedModel'].indexOf(model.name) === -1;
}

module.exports = function (Model) {

  const deletedFlag = 'deleted';
  const deletedAt = 'deletedAt';

  Model.defineProperty(deletedFlag, {
    type: Boolean,
    required: true,
    default: false
  });

  Model.defineProperty(deletedAt, {
    type: Date
  });

  /**
   * Restore a soft-deleted record
   * @param [callback]
   */
  Model.prototype.undoDelete = function (callback) {
    return this.updateAttributes({[deletedFlag]: false, [deletedAt]: null}, callback);
  };

  /**
   * Soft Delete overwrites delete functionality, make sure 'before delete' hooks still work
   */
  Model.observe('before save', function (context, callback) {
    if (isMonitoredModel(Model)) {
      if (context.data) {
        // single record update
        if (context.currentInstance) {
          if (context.data.deleted && context.data.deleted != context.currentInstance.deleted) {
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
      return Promise.reject(error)
    }
    return result;
  }

  /**
   * Overwrite destroyAll with a soft destroyAll
   * @param where
   * @param cb
   * @returns {Promise.<T>}
   */
  Model.destroyAll = function softDestroyAll(where, cb) {
    let nextStep = next.bind({callback: cb});

    return Model
      .updateAll(where, {[deletedFlag]: true, [deletedAt]: new Date()})
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });
  };

  // also update aliases for destroyAll
  Model.remove = Model.destroyAll;
  Model.deleteAll = Model.destroyAll;

  /**
   * Overwrite destroyById with a soft destroyById
   * @param id
   * @param cb
   * @returns {Promise.<TResult>}
   */
  Model.destroyById = function softDestroyById(id, cb) {
    let nextStep = next.bind({callback: cb});

    return Model
      .findById(id)
      .then(function (instance) {
        if (instance) {
          return instance
            .updateAttributes({[deletedFlag]: true, [deletedAt]: new Date()})
            .then(function () {
              return {count: 1};
            });
        }
        return {count: 0};
      })
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });
  };

  // also update aliases for destroyById
  Model.removeById = Model.destroyById;
  Model.deleteById = Model.destroyById;

  /**
   * Overwrite destroy with a soft destroy
   * @param cb
   * @returns {Promise.<TResult>}
   */
  Model.prototype.destroy = function softDestroy(cb) {
    let nextStep = next.bind({callback: cb});

    return this
      .updateAttributes({[deletedFlag]: true, [deletedAt]: new Date()})
      .then(function () {
        return {count: 1};
      })
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });
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
