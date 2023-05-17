'use strict';

const app = require('../../server/server');
const fs = require('fs');
const tmp = require('tmp');
const path = require('path');

module.exports = function (RestoreLog) {
  // set flag to get controller
  RestoreLog.hasController = true;

  // after the application started
  app.on('started', function () {
    // cleanup
    try {
      if (fs.existsSync(tmp.tmpdir)) {
        // used to remove directory
        const removeDirectory = (dirToRemovePath) => {
          // remove directory and its content
          const removeDirectoryRecursive = (dirPath) => {
            if (fs.existsSync(dirPath)) {
              // fs.rmdirSync with "recursive: true" flag doesn't do the job properly...
              fs.readdirSync(dirPath).forEach(function (fileOrDirToRemovePath) {
                const currentPath = `${dirPath}${path.sep}${fileOrDirToRemovePath}`;
                if (fs.lstatSync(currentPath).isDirectory()) {
                  // remove directory content
                  removeDirectoryRecursive(currentPath);
                } else {
                  // delete file
                  fs.unlinkSync(currentPath);
                }
              });

              // remove main directory
              fs.rmdirSync(dirPath);
            }
          };

          // delete directory
          // no matter if it was a success or not
          try {
            removeDirectoryRecursive(dirToRemovePath);
          } catch (remErr) {
            // we don't have rights to delete directory or something has gone wrong...
            // log data and continue as God intended to be..without any worries...
            app.logger.debug(`Failed removing tmp directories: ${remErr}`);
          }
        };

        // used to check and delete files
        const deleteFileOrDirIfMatches = (
          fileOrDir,
          regexMatch
        ) => {
          // does this file match out search criteria ?
          const currentPath = `${tmp.tmpdir}${path.sep}${fileOrDir}`;
          if (
            regexMatch.test(fileOrDir) &&
            fs.existsSync(currentPath)
          ) {
            try {
              // delete file / directory
              if (fs.lstatSync(currentPath).isDirectory()) {
                // delete directory
                removeDirectory(currentPath);
              } else {
                // delete file
                fs.unlinkSync(currentPath);
              }
            } catch (remFileErr) {
              // we don't have rights to delete file or something has gone wrong...
              // log data and continue as God intended to be..without any worries...
              app.logger.error(`Failed removing tmp file / directory: ${remFileErr}`);
            }
          }
        };

        // fs.rmdirSync with "recursive: true" flag doesn't do the job properly...
        fs.readdirSync(tmp.tmpdir).forEach(function (fileOrDir) {
          deleteFileOrDirIfMatches(
            fileOrDir,
            /^restore_/i
          );
        });
      }
    } catch (remErr) {
      // we don't have rights to delete files or something has gone wrong...
      // log data and continue as God intended to be..without any worries...
      app.logger.error(`Failed removing tmp restore data: ${remErr}`);
    }
  });
};
