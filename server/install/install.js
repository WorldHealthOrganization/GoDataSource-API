'use strict';

const async = require('async');
const _ = require('lodash');
const args = process.argv;
// keep a list of supported install arguments
const supportedArguments = ['init-database', 'migrate-database', 'reset-admin-password', 'install-script'];
// keep a list of functions that will be run
const runFunctions = [];
// define a list of supported routines
const routines = {
  initDatabase: function () {
    console.log('Setting Up Database Initialisation...');
    [
      require('./scripts/initDatabaseCollections'),
      require('./scripts/migrateDatabaseCollections'),
      require('./scripts/defaultRolesAndSysAdmin'),
      require('./scripts/defaultLanguages'),
      require('./scripts/defaultSystemSettings'),
      require('./scripts/defaultReferenceData'),
      require('./scripts/defaultLocations')
    ].forEach(function (installScript) {
      runFunctions.push(installScript);
    });
  },
  migrateDatabase: function () {
    console.log('Setting Up Database Migration...');
    [
      require('./scripts/migrateDatabaseCollections'),
      require('./scripts/defaultLanguages'),
      require('./scripts/defaultReferenceData')
    ].forEach(function (installScript) {
      runFunctions.push(installScript);
    });
  },
  resetAdminPassword: function () {
    console.log('Resetting Administrative Password...');
    [
      require('./scripts/resetAdministrativePassword')
    ].forEach(function (installScript) {
      runFunctions.push(installScript);
    });
  },
  installScript: function () {
    let script = /script=(.+)(?:\s+|$)/.exec(args.toString());
    if (!script) {
      return console.error('No valid script name passed. Use -- script=<scriptName> to specify a script');
    }
    script = script.pop();
    console.log(`Running install script ${script}`);
    [
      require(`./scripts/${script}`)
    ].forEach(function (installScript) {
      runFunctions.push(installScript);
    });
  }
};

// check which routines should be run based on the passed arguments
supportedArguments.forEach(function (supportedArgument) {
  if (args.indexOf(supportedArgument) !== -1) {
    routines[_.camelCase(supportedArgument)]();
  }
});

// nothing set to run, no valid arguments passed
if (!runFunctions.length) {
  console.log(`No valid arguments passed. Nothing to do. Available arguments: ${supportedArguments.join(', ')}`);
} else {
  async.series(runFunctions, function (error) {
    if (error) {
      console.error(JSON.stringify(error));
      process.exit(1);
    }
    console.log('Install finished successfully');
    process.exit();
  });
}

