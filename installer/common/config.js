'use strict';

const fs = require('fs');
const _ = require('lodash');
const args = process.argv;

// define the list of sources
const sources = {
  config: {
    path: `${__dirname}/../../server/config.json`,
    data: require('../../server/config')
  },
  dataSources: {
    path: `${__dirname}/../../server/datasources.json`,
    data: require('../../server/datasources')
  },
  package: {
    path: `${__dirname}/../../package.json`,
    data: require('../../package')
  }
};

// define a list of supported CLI arguments, along with their configuration
const cliArguments = {
  apiPort: {
    source: sources.config,
    paramPath: 'port',
    get: {
      convertor: e => e.toString()
    },
    set: {
      allowed: true,
      convertor: e => parseInt(e)
    }
  },
  publicProtocol: {
    source: sources.config,
    paramPath: 'public.protocol',
    get: {
      convertor: e => e.toString()
    },
    set: {
      allowed: false,
      convertor: e => parseInt(e)
    }
  },
  publicHost: {
    source: sources.config,
    paramPath: 'public.host',
    get: {
      convertor: e => e
    },
    set: {
      allowed: false,
      convertor: e => e
    }
  },
  publicPort: {
    source: sources.config,
    paramPath: 'public.port',
    get: {
      convertor: e => e ? e.toString() : ''
    },
    set: {
      allowed: false,
      convertor: e => e ? parseInt(e) : ''
    }
  },
  logLevel: {
    source: sources.config,
    paramPath: 'logging.level',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  dbHost: {
    source: sources.dataSources,
    paramPath: 'mongoDb.host',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  dbPort: {
    source: sources.dataSources,
    paramPath: 'mongoDb.port',
    get: {
      convertor: e => e.toString()
    },
    set: {
      allowed: true,
      convertor: e => parseInt(e)
    }
  },
  dbUser: {
    source: sources.dataSources,
    paramPath: 'mongoDb.user',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  dbPassword: {
    source: sources.dataSources,
    paramPath: 'mongoDb.password',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  smtpHost: {
    source: sources.dataSources,
    paramPath: 'email.transports.0.host',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  smtpPort: {
    source: sources.dataSources,
    paramPath: 'email.transports.0.port',
    get: {
      convertor: e => e.toString()
    },
    set: {
      allowed: true,
      convertor: e => parseInt(e)
    }
  },
  smtpSecure: {
    source: sources.dataSources,
    paramPath: 'email.transports.0.secure',
    get: {
      convertor: e => e.toString()
    },
    set: {
      allowed: true,
      convertor: e => e === 'true'
    }
  },
  smtpUser: {
    source: sources.dataSources,
    paramPath: 'email.transports.0.auth.user',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  smtpPassword: {
    source: sources.dataSources,
    paramPath: 'email.transports.0.auth.pass',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  buildPlatform: {
    source: sources.package,
    paramPath: 'build.platform',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  version: {
    source: sources.package,
    paramPath: 'build.version',
    get: {
      convertor: e => e
    },
    set: {
      allowed: false,
      convertor: e => e
    }
  },
  buildNumber: {
    source: sources.package,
    paramPath: 'build.build',
    get: {
      convertor: e => e
    },
    set: {
      allowed: false,
      convertor: e => e
    }
  },
  buildArch: {
    source: sources.package,
    paramPath: 'build.arch',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
  backUpPassword: {
    source: sources.config,
    paramPath: 'backUp.password',
    get: {
      convertor: e => e
    },
    set: {
      allowed: true,
      convertor: e => e
    }
  },
};

/**
 * Output a message to stdout/stderr and end process
 * @param message
 * @param isError
 */
function output(message, isError) {
  // use stderr/stdout per message type
  process[isError ? 'stderr' : 'stdout'].write(`${message}\n`);
  process.exit(isError ? 1 : 0);
}

// define the list of supported commands
const supportedCommands = ['get', 'set'];

// get the command from the process arguments
let command;
supportedCommands.forEach(function (supportedCommand) {
  if (!command && args.includes(supportedCommand)) {
    command = supportedCommand;
  }
});

// check if the command is invalid
if (!command) {
  output(`No valid command specified. Available commands: \n- ${supportedCommands.join('\n- ')}`, true);
}

// define the list of supported arguments
const supportedArguments = Object.keys(cliArguments);

// get the command argument from the process arguments
let argument;
let argumentIndex;
supportedArguments.forEach(function (supportedArgument) {
  if (!argument && (argumentIndex = args.indexOf(supportedArgument)) !== -1) {
    argument = supportedArgument;
  }
});

// check if the command argument is valid
if (!argument) {
  output(`No valid argument specified. Available arguments: \n- ${supportedArguments.join('\n- ')}`, true);
}

// define vars to be used later
let argumentValue, convertedValue;

/**
 * Handle CLI commands
 */
switch (command) {
  case 'set':
    // check if setting the argument is allowed
    if (!cliArguments[argument][command].allowed) {
      output(`Setting ${argument} is not allowed`, true);
    }
    // set command must specify an argument value (the next process argument after command argument)
    argumentValue = args[argumentIndex + 1];
    if (argumentValue === undefined) {
      output(`No argument value sent. You can specify argument value like this: ${command} ${argument} <argumentValue>`, true);
    }
    // convert the value to expected format
    convertedValue = cliArguments[argument][command].convertor(argumentValue);
    // update the value in the configuration
    _.set(cliArguments[argument].source.data, cliArguments[argument].paramPath, convertedValue);
    // update configuration
    fs.writeFile(cliArguments[argument].source.path, JSON.stringify(cliArguments[argument].source.data, null, 2), function (error) {
      if (error) {
        output(JSON.stringify(error), true);
      }
      output(`Success: ${command} ${argument} ${convertedValue.toString()}`, false);
    });
    break;
  case 'get':
    // read the configuration value
    output(cliArguments[argument][command].convertor(_.get(cliArguments[argument].source.data, cliArguments[argument].paramPath)), false);
    break;
}
