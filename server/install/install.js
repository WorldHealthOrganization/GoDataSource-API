'use strict';

const async = require('async');
const _ = require('lodash');
const args = process.argv;
const path = require('path');
// keep a list of supported install arguments
const supportedArguments = [
  'init-database',
  'migrate-database',
  'reset-admin-password',
  'install-script',
  'dump-help-data',
  'dump-language-data',
  'dump-outbreak-template-data',
  'remove-unused-language-tokens',
  'populate-with-dummy-data',
  'determine-and-dump-reference-data-items',
  'populate-missing-language-tokens'
];
// keep a list of functions that will be run
const runFunctions = [];

// parse types
const PARSE_TYPE = {
  BOOLEAN: 'boolean',
  STRING: 'string'
};

// retrieve argument values
const parseArgumentValues = (argsToRetrieve) => {
  // determine arguments values
  const argValues = {};
  (argsToRetrieve || []).forEach((argKeyOrObject) => {
    // determine name
    const argKey = _.isObject(argKeyOrObject) ? argKeyOrObject.name : argKeyOrObject;
    if (!argKey) {
      console.log('Invalid argument...');
      return;
    }

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

          // convert response to type
          if (
            _.isObject(argKeyOrObject) &&
            argKeyOrObject.type
          ) {
            switch (argKeyOrObject.type) {
              case PARSE_TYPE.BOOLEAN:
                const value = argValues[argKey].toString().toLowerCase();
                argValues[argKey] = value === 'true' || value === '1';
                break;
            }
          }
        }
      }
    });
  });

  // finished
  return argValues;
};

// define a list of supported routines
let methodRelevantArgs;
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
      require('./scripts/migrateModelData'),
      require('./scripts/migrateRolesAndUsers'),
      require('./scripts/populateMissingLanguageTokens')
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
      'subLocationsLevelsNo',
      'minNoRelationshipsForEachRecord',
      'maxNoRelationshipsForEachRecord'
    ];
    methodRelevantArgs = parseArgumentValues(requiredArgs);

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
  },
  determineAndDumpReferenceDataItems: function () {
    // where to check if reference data item from database are missing ?
    const requiredArgs = [
      {
        name: 'checkDefaultReferenceData',
        type: PARSE_TYPE.BOOLEAN
      }, {
        name: 'checkDefaultOutbreakTemplateData',
        type: PARSE_TYPE.BOOLEAN
      }
    ];
    methodRelevantArgs = parseArgumentValues([
      ...requiredArgs, ...[
        {
          name: 'export',
          type: PARSE_TYPE.STRING
        }
      ]
    ]);

    // all above arg are required
    let stop = false;
    _.each(requiredArgs, (argKey) => {
      if (methodRelevantArgs[argKey.name] === undefined) {
        console.log(`The following arguments are required: ${requiredArgs.map(item => item.name).join(', ')}`);
        stop = true;
        return false;
      }
    });
    if (stop) {
      return;
    }

    // determine missing reference data items
    console.log('Determine missing reference data items');
    [
      require('./scripts/determineAndDumpReferenceDataItems')
    ].forEach(function (installScript) {
      runFunctions.push(installScript(methodRelevantArgs));
    });
  },
  populateMissingLanguageTokens: function () {
    // determine missing reference data items
    console.log('Determine and populate missing language tokens');
    [
      require('./scripts/populateMissingLanguageTokens')
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

