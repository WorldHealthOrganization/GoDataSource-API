'use strict';

const async = require('async');
const args = process.argv;
const initDatabase = args.indexOf('init-database') !== -1;
const migrateDatabase = args.indexOf('migrate-database') !== -1;

const installFunctions = [];

function setupDatabaseInit() {
  console.log('Setting Up Database Initialisation...');
  [
    require('./scripts/initDatabaseCollections'),
    require('./scripts/migrateDatabaseCollections'),
    require('./scripts/defaultRolesAndSysAdmin'),
    require('./scripts/installLanguages'),
    require('./scripts/defaultSystemSettings')
  ].forEach(function (installScript) {
    installFunctions.push(installScript);
  });
}

function setupDatabaseMigration() {
  console.log('Setting Up Database Migration...');
  [
    require('./scripts/migrateDatabaseCollections')
  ].forEach(function (installScript) {
    installFunctions.push(installScript);
  });
}

if (initDatabase) {
  setupDatabaseInit();
}

if (migrateDatabase) {
  setupDatabaseMigration();
}

if (!installFunctions.length) {
  console.log('No arguments passed. Nothing to do. Available arguments: init-database, migrate-database');
} else {
  async.series(installFunctions, function (error) {
    if (error) {
      console.error(JSON.stringify(error));
      process.exit(1);
    }
    console.log('Install finished successfully');
    process.exit();
  });
}

