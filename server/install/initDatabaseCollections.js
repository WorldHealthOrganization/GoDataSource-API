'use strict';

/**
 * Init Database. WARNING - this should be run only post install as it recreates the collections
 */
const app = require('../server');
const migrations = [];

app.models().forEach(function (Model) {
  const dataSource = Model.dataSource;
  if (dataSource && Model.name.match(/^[a-z]/)) {
    migrations.push(function migrate(callback) {
      console.log(`(Re)Creating ${Model.name}...`);
      dataSource.automigrate(Model.name, callback);
    });
  }
});

(function migrate() {
  if (migrations.length) {
    const migration = migrations.shift();
    migration(function (error) {
      if (error) {
        throw error;
      }
      migrate();
    });
  } else {
    console.log('Init complete.');
    process.exit();
  }
})();
