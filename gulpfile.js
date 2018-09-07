'use strict';

const gulp = require('gulp');
const uglify = require('gulp-uglify-es').default;
const clean = require('gulp-clean');
const pump = require('pump');

/**
 * Clean up build directory
 */
gulp.task('clean', function (callback) {
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
          '!_devTools',
          '!_devTools/**',
          '!ApiDefinitions*',
          '!ApiDefinitions/**',
          '!node_modules',
          '!node_modules/**',
          '!gulpfile.js',
          '!installer',
          '!installer/**',
          'installer/common/**'
        ]
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


gulp.task('default', ['compress']);
