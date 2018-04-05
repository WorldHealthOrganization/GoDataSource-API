'use strict';

module.exports = function (Model) {

  const deletedFlag = 'deleted';

  Model.defineProperty(deletedFlag, {
    type: Boolean,
    required: true,
    default: false
  });


  function next(error, result) {
    if (this.cb === 'function') {
      return this.cb(error, result);
    }
    if (error) {
      return Promise.reject(error)
    }
    return result;
  }

  //TODO: handle destroyAll/updateAll in audit logger
  Model.destroyAll = function softDestroyAll(where, cb) {
    let nextStep = next.bind({callback: cb});

    return Model
      .updateAll(where, {[deletedFlag]: true})
      .then(function (result) {
        return nextStep(null, result);
      })
      .catch(function (error) {
        return nextStep(error);
      });
  };

  Model.remove = Model.destroyAll;
  Model.deleteAll = Model.destroyAll;

  Model.destroyById = function softDestroyById(id, cb) {
    let nextStep = next.bind({callback: cb});

    return Model
      .findById(id)
      .then(function (instance) {
        if (instance) {
          return instance
            .updateAttributes({[deletedFlag]: true})
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

  Model.removeById = Model.destroyById;
  Model.deleteById = Model.destroyById;

  Model.prototype.destroy = function softDestroy(cb) {
    let nextStep = next.bind({callback: cb});

    return this
      .updateAttributes({[deletedFlag]: true})
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

  Model.prototype.remove = Model.prototype.destroy;
  Model.prototype.delete = Model.prototype.destroy;

  const queryNonDeleted = {
    [deletedFlag]: {
      neq: true
    }
  };

  const _findOrCreate = Model.findOrCreate;
  Model.findOrCreate = function findOrCreateDeleted(query = {}, ...rest) {
    if (!query.where) query.where = {};

    if (!query.deleted) {
      query.where = {and: [query.where, queryNonDeleted]};
    }

    return _findOrCreate.call(Model, query, ...rest);
  };

  const _find = Model.find;
  Model.find = function findDeleted(query = {}, ...rest) {
    if (!query.where) query.where = {};

    if (!query.deleted) {
      query.where = {and: [query.where, queryNonDeleted]};
    }

    return _find.call(Model, query, ...rest);
  };

  const _count = Model.count;
  Model.count = function countDeleted(where = {}, ...rest) {
    // Because count only receives a 'where', there's nowhere to ask for the deleted entities.
    const whereNotDeleted = {and: [where, queryNonDeleted]};
    return _count.call(Model, whereNotDeleted, ...rest);
  };

  const _update = Model.update;
  Model.update = Model.updateAll = function updateDeleted(where = {}, ...rest) {
    // Because update/updateAll only receives a 'where', there's nowhere to ask for the deleted entities.
    const whereNotDeleted = {and: [where, queryNonDeleted]};
    return _update.call(Model, whereNotDeleted, ...rest);
  };
};
