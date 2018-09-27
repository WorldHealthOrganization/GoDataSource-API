'use strict';

const fork = require('child_process').fork;
const workersPath = `${__dirname}/../components/workers`;

/**
 * Invoke worker method
 * @param workerName
 * @param method
 * @param args
 * @param callback
 */
function invokeWorkerMethod(workerName, method, args, callback) {
  // callback is the initial one
  let cb = callback;

  /**
   * Execute callback only once
   * @param error
   * @param result
   */
  function next(error, result) {
    // execute callback
    cb(error, result);
    // replace callback with no-op to prevent calling it multiple times
    cb = function noOp(){};
  }
  // fork the worker
  const worker = fork(`${workersPath}/${workerName}`, [], {execArgv: []});
  // invoke it
  worker.send({fn: method, args});
  // wait for it's response and process it
  worker.on('message', function (args) {
    if (args[0]) {
      return next(args[0]);
    }
    next(null, args[1]);
    worker.kill();
  });
  // in case of failure, stop with error
  ['close', 'disconnect', 'error', 'exit'].forEach(function (event) {
    worker.on(event, function () {
      next(new Error(`Processing failed. Worker stopped. Event: ${event}, details: ${JSON.stringify(arguments)}`));
    });
  });
}


module.exports = {
  transmissionChain: {
    build: function (relationships, followUpPeriod, callback) {
      invokeWorkerMethod('transmissionChain', 'build', [relationships, followUpPeriod], callback);
    },
    count: function (relationships, followUpPeriod, callback) {
      invokeWorkerMethod('transmissionChain', 'count', [relationships, followUpPeriod], callback);
    }
  },
  personDuplicate: {
    find: function (people, callback) {
      invokeWorkerMethod('personDuplicate', 'find', [people], callback)
    },
    count: function (people, callback) {
      invokeWorkerMethod('personDuplicate', 'count', [people], callback)
    }
  }
};
