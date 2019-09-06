'use strict';

const async = require('async');
const _ = require('lodash');
const args = process.argv;
const path = require('path');
// keep a list of supported install arguments
const supportedArguments = ['init-database', 'migrate-database', 'reset-admin-password', 'install-script', 'dump-help-data', 'dump-language-data', 'dump-outbreak-template-data', 'remove-unused-language-tokens', 'populate-with-dummy-data'];
// keep a list of functions that will be run
const runFunctions = [];

// retrieve argument values
const parseArgumentValues = (argsToRetrieve) => {
  // determine arguments values
  const argValues = {};
  (argsToRetrieve || []).forEach((argKey) => {
    // construct regex for this argument
    const argRegex = new RegExp(`^${argKey}=(.+)`, 'i');

    // check if we have a match
    (args || []).forEach((argValue) => {
      // check argument value
      if (argRegex.test(argValue)) {
        const result = argRegex.exec(argValue);
        if (
          result &&
          result.length >= 1
        ) {
          argValues[argKey] = result[1];
        }
      }
    });
  });

  // finished
  return argValues;
};

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
      require('./scripts/defaultLocations'),
      require('./scripts/defaultHelpData'),
      require('./scripts/defaultOutbreakTemplateData'),
      require('./scripts/migrateModelData')
    ].forEach(function (installScript) {
      runFunctions.push(installScript);
    });
  },
  migrateDatabase: function () {
    console.log('Setting Up Database Migration...');
    [
      require('./scripts/migrateDatabaseCollections'),
      require('./scripts/defaultLanguages'),
      require('./scripts/defaultReferenceData'),
      require('./scripts/defaultHelpData'),
      require('./scripts/defaultOutbreakTemplateData'),
      require('./scripts/migrateModelData')
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
  },
  dumpHelpData: function () {
    // need export file
    let exportPath = /export=(.+)(?:\s+|$)/.exec(args.toString());
    if (!exportPath) {
      return console.error('No valid file path. Use -- export=<filePath> to specify a file where to export data');
    }
    exportPath = exportPath.pop();

    // check if we have access to write to this file
    const resolvedPath = path.resolve(exportPath);

    // dump data
    console.log('Dumping Help Data...');
    [
      require('./scripts/dumpHelpData')
    ].forEach(function (installScript) {
      runFunctions.push(installScript(resolvedPath));
    });
  },
  dumpLanguageData: function () {
    // need export file
    let exportPath = /export=(.+)(?:\s+|$)/.exec(args.toString());
    if (!exportPath) {
      return console.error('No valid file path. Use -- export=<filePath> to specify a file where to export data');
    }
    exportPath = exportPath.pop();

    // check if we have access to write to this file
    const resolvedPath = path.resolve(exportPath);

    // dump data
    console.log('Dumping Language Data...');
    [
      require('./scripts/dumpLanguageData')
    ].forEach(function (installScript) {
      runFunctions.push(installScript(resolvedPath));
    });
  },
  dumpOutbreakTemplateData: function () {
    // need export file
    let exportPath = /export=(.+)(?:\s+|$)/.exec(args.toString());
    if (!exportPath) {
      return console.error('No valid file path. Use -- export=<filePath> to specify a file where to export data');
    }
    exportPath = exportPath.pop();

    // check if we have access to write to this file
    const resolvedPath = path.resolve(exportPath);

    // dump data
    console.log('Dumping Outbreak Template Data...');
    [
      require('./scripts/dumpOutbreakTemplateData')
    ].forEach(function (installScript) {
      runFunctions.push(installScript(resolvedPath));
    });
  },
  removeUnusedLanguageTokens: function () {
    // need export file
    let confirmRemoval = /confirm=(.+)(?:\s+|$)/.exec(args.toString());
    if (!confirmRemoval) {
      console.log('NO REMOVAL SELECTED');
    } else {
      console.log('REMOVAL SELECTED');
    }

    // dump data
    console.log('Determining unused language tokens');
    [
      require('./scripts/removeUnusedLanguageTokens')
    ].forEach(function (installScript) {
      runFunctions.push(installScript(confirmRemoval));
    });
  },
  populateWithDummyData: function () {
    // need outbreak name & data amount
    const requiredArgs = [
      'outbreakName',
      'casesNo',
      'contactsNo',
      'eventsNo',
      'locationsNo',
      'subLocationsPerLocationNo',
      'minNoRelationshipsForEachRecord',
      'maxNoRelationshipsForEachRecord'
    ];
    const methodRelevantArgs = parseArgumentValues(requiredArgs);

    // all above arg are required
    let stop = false;
    _.each(requiredArgs, (argKey) => {
      if (!methodRelevantArgs[argKey]) {
        console.log(`The following arguments are required: ${requiredArgs.join(', ')}`);
        stop = true;
        return false;
      }
    });
    if (stop) {
      return;
    }

    // populate database
    console.log('Populating database');
    [
      require('./scripts/populateWithDummyData')
    ].forEach(function (installScript) {
      runFunctions.push(installScript(methodRelevantArgs));
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

