'use strict';

/**
 * Migrate Database. WARNING - this should be run only after the collections are created as it only update what changed
 */
const app = require('../../server');
const migrations = [];
let connected = false;

/**
 * Set up collections
 */
app.models().forEach(function (Model) {
  const dataSource = Model.dataSource;
  if (dataSource && Model.modelName.match(/^[a-z]/)) {
    migrations.push(function migrate(callback) {
      if (!connected) {
        dataSource.connect(function () {
          console.log(`Migrating ${Model.modelName}...`);
          dataSource.autoupdate(Model.modelName, callback);
        });
      } else {
        console.log(`Migrating ${Model.modelName}...`);
        dataSource.autoupdate(Model.modelName, callback);
      }
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
    console.log('Migration complete.');
    callback();
  }
}

module.exports = run;
