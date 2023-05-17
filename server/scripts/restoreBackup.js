'use strict';

// requires
const backup = require('../../components/backup');

// script arguments
let args = process.argv;

// file argument is required
let file = /file=(.+)(?:\s+|$)/.exec(args.toString());
if (!file) {
  console.error('No valid file passed. Use --file=<filePath> to specify a backup file');
  process.exit(1);
}

// extract file path from argument
let filePath = file.pop();

// restore using provided file
backup.restoreFromFile(
  filePath,
  // restore log will be created by backup.restoreFromFile if no id is provided
  undefined,
  (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    // stop with success
    console.log(`Successfully restored backup: ${filePath}`);
    process.exit();
  }
);


