'use strict';

// requires
const backup = require('../../components/backup');

// script arguments
let args = process.argv;

// file argument is required
let file = /file=(.+)(?:\s+|$)/.exec(args.toString());
if (!file) {
  return console.error('No valid file passed. Use --file=<filePath> to specify a backup file');
}

// restore using provided file
backup.restoreFromFile(file.pop(), (err) => {
  if (err) {
    console.error(err);
  }

  // stop with success
  console.log('Successfully restored backup');
  process.exit(1);
});


