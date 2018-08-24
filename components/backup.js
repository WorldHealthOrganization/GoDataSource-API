'use strict';

// requires
const app = require('../server/server');
const fs = require('fs');
const path = require('path');

/**
 * Create a new backup file at the desired location and for given application modules
 * @param userId
 * @param modules
 * @param location
 * @param done
 */
const createBackup = function (userId, modules, location, done) {
  const models = app.models;

  // collect all collections that must be exported, based on the modules
  let collections = [];
  modules.forEach((module) => {
    if (models.backup.modules.hasOwnProperty(module)) {
      collections.push(...app.models.backup.modules[module]);
    }
  });

  // make sure the location path of the backups exists and is accesible
  fs.access(location, fs.F_OK, (accessError) => {
    if (accessError) {
      app.logger.error(`Backup location: ${location} is not OK. ${accessError}`);
      return done(accessError);
    }

    // run the database export
    models.sync.exportDatabase(null, collections, null, (exportError, archivePath) => {
      if (exportError) {
        app.logger.error(`Backup process failed. ${exportError}`);
        return done(exportError);
      }

      // get file name from archive path
      let fileParse = path.parse(archivePath);
      let fileName = fileParse.name + fileParse.ext;

      // build new path for the backup file
      let newPath = `${location}/${fileName}`;

      // copy the archive from temporary OS directory to the desired location
      fs.copyFile(archivePath, newPath, (copyError) => {
        if (copyError) {
          app.logger.error(`Failed to copy backup file from path ${archivePath} to ${newPath}. ${copyError}`);
          return done(copyError);
        }

        // create new backup record
        models.backup
          .create(
            {
              automatic: false,
              modules: modules,
              location: newPath,
              userId: userId
            }
          )
          .then((record) => done(null, record.id))
          .catch((createError) => done(createError));
      });
    });
  });
};

/**
 * Restore the system using a backup entry
 * @param backupId
 * @param requestOptions
 * @param done
 */
const restoreBackup = function (backupId, requestOptions, done) {
  
};

/**
 * Restore a backup from file
 * Request options are required for logging to work as expected
 * @param filePath
 * @param requestOptions
 * @param done
 */
const restoreBackupFromFile = function (filePath, requestOptions, done) {
  // make sure the file actually exists and is accessible
  fs.access(location, fs.F_OK, (accessError) => {
    if (accessError) {
      app.logger.error(`Backup file: ${filePath} is not OK. ${accessError}`);
      return done(accessError);
    }

    // run the synchronization process
    app.models.sync.syncDatabaseWithSnapshot(filePath, requestOptions, done);
  });
};

module.exports = {
  create: createBackup,
  restore: restoreBackupFromFile
};
