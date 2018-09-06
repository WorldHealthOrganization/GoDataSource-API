'use strict';

const fs = require('fs');
const _ = require('lodash');

const sources = {
  config: {
    path: `${__dirname}/../../server/config.json`,
    data: require('../../server/config')
  },
  dataSources: {
    path: `${__dirname}/../../server/datasources.json`,
    data: require('../../server/datasources')
  }
};

const args = process.argv;

const CLI = {
  set: {
    apiPort: {
      source: sources.config,
      path: 'port',
      convertor: e => parseInt(e)
    }
  },
  get: {
    apiPort: {
      source: sources.config,
      path: 'port',
      convertor: e => e.toString()
    }
  }
};

const supportedCommands = Object.keys(CLI);

let command;

supportedCommands.forEach(function (supportedCommand) {
  if (!command && args.includes(supportedCommand)) {
    command = supportedCommand;
  }
});

if (!command) {
  process.stderr.write(`\nNo valid command specified. Available commands: \n- ${supportedCommands.join('\n- ')}\n`);
  process.exit(1);
}

const supportedArguments = Object.keys(CLI[command]);

let argument;
let argumentIndex;
supportedArguments.forEach(function (supportedArgument) {
  if (!argument && (argumentIndex = args.indexOf(supportedArgument)) !== -1) {
    argument = supportedArgument;
  }
});

if (!argument) {
  process.stderr.write(`\nNo valid argument specified. Available arguments: \n- ${supportedArguments.join('\n- ')}\n`);
  process.exit(1);
}

switch (command) {
  case 'set':
    let argumentValue = args[argumentIndex + 1];
    if (argumentValue === undefined){
      process.stderr.write(`\nNo argument value sent. You can specify argument value like this: ${command} ${argument} <argumentValue>`);
      process.exit(1);
    }
    let convertedValue =  CLI[command][argument].convertor(argumentValue);
    _.set(CLI[command][argument].source.data, CLI[command][argument].path, CLI[command][argument].convertor(argumentValue));
    fs.writeFile(CLI[command][argument].source.path, JSON.stringify(CLI[command][argument].source.data, null, 2), function (error) {
      if (error) {
        process.stderr.write(JSON.stringify(error));
        process.exit(1);
      }
      process.stdout.write(`Success: ${command} ${argument} ${convertedValue.toString()}`);
      process.exit();
    });
    break;
  case 'get':
    process.stdout.write(CLI[command][argument].convertor(_.get(CLI[command][argument].source.data, CLI[command][argument].path)));
    process.exit();
    break;
}
