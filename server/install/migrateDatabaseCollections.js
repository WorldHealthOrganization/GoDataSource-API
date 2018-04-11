'use strict';

/**
 * Migrate Database. WARNING - this should be run only after the collections are created as it only update what changed
 */
const app = require('../server');
const migrations = [];

app.models().forEach(function (Model) {
  const dataSource = Model.dataSource;
  if (dataSource && Model.name.match(/^[a-z]/)) {
    migrations.push(function migrate(callback) {
      console.log(`Migrating ${Model.name}...`);
      dataSource.autoupdate(Model.name, callback);
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
    console.log('Migration complete.');
    process.exit();
  }
})();
