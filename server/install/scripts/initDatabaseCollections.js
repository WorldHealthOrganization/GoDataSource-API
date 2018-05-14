'use strict';

/**
 * Init Database. WARNING - this should be run only post install as it recreates the collections
 */
const app = require('../../server');
const migrations = [];

/**
 * Set up collections
 */
app.models().forEach(function (Model) {
  const dataSource = Model.dataSource;
  if (dataSource && Model.modelName.match(/^[a-z]/)) {
    migrations.push(function migrate(callback) {
      console.log(`(Re)Creating ${Model.modelName}...`);
      dataSource.automigrate(Model.modelName, callback);
    });
  }
});


/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  if (migrations.length) {
    const migration = migrations.shift();
    migration(function (error) {
      if (error) {
        return callback(error);
      }
      run(callback);
    });
  } else {
    console.log('Init complete.');
    callback();
  }
}

module.exports = run;
