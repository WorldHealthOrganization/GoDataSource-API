'use strict';

const async = require('async');

// keep a list of functions that will be run
const runFunctions = [];
[
  require('./migrateDatabaseCollections'),
  require('./migrateModelData'),
  require('./updateAdminEmail')
].forEach(function (installScript) {
  runFunctions.push(installScript);
});

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  async.series(runFunctions, callback);
}


// execution in install script
module.exports = run;
