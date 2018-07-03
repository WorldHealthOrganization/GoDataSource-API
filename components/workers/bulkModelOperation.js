'use strict';

const app = require('../../server/server');
const async = require('async');

const worker = {
  /**
   * Perform a mass delete, but delete each record individually
   * @param modelName
   * @param where
   * @param callback
   */
  deleteOneByOne: function (modelName, where, callback) {
    // find the models that need to be deleted
    app.models[modelName]
      .find({where: where})
      .then(function (instancesToDelete) {
        // create a list of delete operations
        let deleteOperations = [];
        // for each instance, schedule a delete
        instancesToDelete.forEach(function (instance) {
          deleteOperations.push(function (callback) {
            instance.destroy(callback);
          });
        });
        // delete them (in series) and send back the number of deleted records
        async.series(deleteOperations, function (error) {
          callback(error, instancesToDelete.length)
        });
      })
      .catch(callback);
  },
  /**
   * Perfom a mass restore, but restore each record individually
   * @param modelName
   * @param where
   * @param callback
   */
  restoreOneByOne: function (modelName, where, callback) {
    app.models[modelName]
      .find({
        where: where,
        deleted: true
      })
      .then(function (deletedInstances) {
        // create a list of restore operations
        let restoreOperations = [];
        // for each instance, schedule a restore
        deletedInstances.forEach(function (instance) {
          restoreOperations.push(function (callback) {
            instance.undoDelete(callback);
          });
        });
        // restore them (in series) and send back the number of restored records
        async.series(restoreOperations, function (error) {
          callback(error, deletedInstances.length)
        });
      })
      .catch(callback);
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args, function (error, result) {
    process.send([error, result]);
  });
});

