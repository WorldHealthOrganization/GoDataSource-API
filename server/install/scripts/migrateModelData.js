'use strict';

const app = require('../../server');
const async = require('async');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
let options = {
  _init: true,
  _sync: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // migrate model data
  const jobs = [];
  app.models().forEach((Model) => {
    // does this model have a migrate function ?
    if (Model.migrate) {
      jobs.push((cb) => {
        // display migration message
        app.logger.debug(`Migrating ${Model.modelName}`);

        // start migrate
        Model.migrate(options, (err) => {
          // display message
          app.logger.debug(`Finished migrating ${Model.modelName}`);

          // finished
          cb(err);
        });
      });
    }
  });

  // wait for all operations to be done
  async.parallelLimit(jobs, 10, callback);
}

module.exports = run;
