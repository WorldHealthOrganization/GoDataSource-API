'use strict';

const gulp = require('gulp');
const uglify = require('gulp-uglify-es').default;
const clean = require('gulp-clean');
const pump = require('pump');
const run = require('gulp-run-command').default;
const fs = require('fs');
const moment = require('moment');

let platform = 'windows-x86';
let type = 'hub';
let version;

/**
 * Prepare build
 */
gulp.task('prepare-build', function (callback) {
  // get platform and type from CLI
  process.argv.forEach(function (arg, index) {
    if (arg === '--platform') {
      platform = process.argv[index + 1];
    }
    if (arg === '--type') {
      type = process.argv[index + 1];
    }
    if (arg === '--version') {
      version = process.argv[index + 1];
    }
  });

  // keep a list of errors
  const errors = [];

  // validate platform
  const supportedPlatforms = ['windows-x86', 'windows-x64', 'mac_osx-x64', 'linux_debian-x86', 'linux_debian-x64', 'linux_rhel-x86', 'linux_rhel-x64'];
  if (!supportedPlatforms.includes(platform)) {
    errors.push(`Invalid platform: ${platform}. Supported platforms: ${supportedPlatforms.join(', ')}`);
  }

  // validate type
  const supportedTypes = ['hub', 'consolidation-server'];
  if (!supportedTypes.includes(type)) {
    errors.push(`Invalid platform: ${type}. Supported platforms: ${supportedTypes.join(', ')}`);
  }

  // check if there are errors
  if (errors.length) {
    return callback(errors);
  }
  // output build information
  process.stdout.write(`\nBuilding ${type} for ${platform}.\nYou can specify other types and platforms by sending arguments. E.g.: npm run build -- --version 1.1.1 --type hub --platform windows-x86\n\n`);
  callback();
});

/**
 * Clean up build directory
 */
gulp.task('clean', ['prepare-build'], function (callback) {
  pump(
    [
      gulp.src(
        [
          'build'
        ]
      ),
      clean()
    ],
    callback
  );
});

/**
 * Copy source files to build directory
 */
gulp.task('copy', ['clean'], function (callback) {
  pump(
    [
      gulp.src(
        [
          '**',
          '!build',
          '!build/**',
          '!node_modules',
          '!node_modules/**',
          '!gulpfile.js'
        ],
        {buffer: false}
      ),
      gulp.dest('build')
    ],
    callback
  );
});

/**
 * Compress source
 */
gulp.task('compress', ['copy'], function (callback) {
  pump(
    [
      gulp.src(['build/**/*.js']),
      uglify(),
      gulp.dest('build')
    ],
    callback
  );
});

/**
 * Install dependencies
 */
gulp.task('install-dependencies', ['compress'], run('npm install --production', {
  cwd: `${__dirname}/build`
}));

/**
 * Update build information
 */
gulp.task('update-build-info', ['install-dependencies'], function (callback) {
  const packageJson = require('./build/package');
  if (!packageJson.build) {
    packageJson.build = {};
  }
  // set build information
  packageJson.build.platform = platform;
  packageJson.build.type = type;
  packageJson.build.version = version || packageJson.version;
  packageJson.build.build = moment().format('YYMMDDHHmm');
  packageJson.build.arch = packageJson.build.arch || 'x64';
  // remove unneeded information
  delete packageJson.devDependencies;
  fs.writeFile(`${__dirname}/build/package.json`, JSON.stringify(packageJson, null, 2), callback);
});

// run build process (task)
gulp.task('build', ['update-build-info']);
