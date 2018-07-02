'use strict';

const app = require('../../server/server');
const async = require('async');

const worker = {
  deleteOneByOne: function (modelName, where, callback) {
    app.models[modelName]
      .find({where: where})
      .then(function (instancesToDelete) {
        let deleteOperations = [];

        instancesToDelete.forEach(function (instance) {
          deleteOperations.push(function (callback) {
            instance.destroy(callback);
          });
        });
        async.series(deleteOperations, function (error) {
          callback(error, instancesToDelete.length)
        });
      })
      .catch(callback);
  },
  undoDeleteOneByOne: function (modelName, where, callback) {
    app.models[modelName]
      .find({
        where: where,
        deleted: true
      })
      .then(function (deletedInstances) {
        deletedInstances.forEach(async function (instance) {
          await instance.undoDelete();
        });
        callback(null, deletedInstances.length)
      })
      .catch(callback);
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args, function (error, result) {
    process.send([error, result]);
  });
});

