'use strict';

// requires
const app = require('../../server/server');
const fs = require('fs');
const path = require('path');

module.exports = function (Backup) {

  // Only list endpoint
  app.utils.remote.disableRemoteMethods(Backup, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'count'
  ]);


  /**
   * Create a backup of the application
   * The following request body params are configurable (if any is missing, fallback on system settings):
   * - location Absolute location of the backup file
   * - modules Application modules to backup
   * @param params
   * @param done
   * @returns {*}
   */
  Backup.createBackup = function (params, requestOptions, done) {
    // defensive checks
    params = params || {};

    // get the id of the authenticated user from request options
    let userId = requestOptions.accessToken.userId;

    // retrieve system settings, used to fallback on default data backup settings, if not available in the request
    app.models.systemSettings
      .findOne()
      .then((systemSettings) => {
        params.location = params.location || systemSettings.dataBackup.location;
        params.modules = params.modules || systemSettings.dataBackup.modules;

        // collect all collections that must be exported, based on the modules
        let collections = [];
        params.modules.forEach((module) => {
          if (Backup.modules.hasOwnProperty(module)) {
            collections.push(...Backup.modules[module]);
          }
        });

        // make sure the location path of the backups exists and is accesible
        fs.access(params.location, fs.F_OK, (accessError) => {
          if (accessError) {
            app.logger.error(`Backup location: ${params.location} is not OK. ${accessError}`);
            return done(accessError);
          }

          // run the database export
          app.models.sync.exportDatabase(null, collections, null, (exportError, archivePath) => {
            if (exportError) {
              app.logger.error(`Backup process failed. ${exportError}`);
              return done(exportError);
            }

            // get file name from archive path
            let fileParse = path.parse(archivePath);
            let fileName = fileParse.name + fileParse.ext;

            // build new path for the backup file
            let newPath = `${params.location}/${fileName}`;

            // copy the archive from temporary OS directory to the desired location
            fs.copyFile(archivePath, newPath, (copyError) => {
              if (copyError) {
                app.logger.error(`Failed to copy backup file from path ${archivePath} to ${newPath}. ${copyError}`);
                return done(copyError);
              }

              // create new backup record
              app.models.backup
                .create(
                  {
                    automatic: false,
                    modules: params.modules,
                    location: newPath,
                    userId: userId
                  }
                )
                .then((record) => done(null, record.id))
                .catch((createError) => done(createError));
            });
          });
        });
      });
  };
};
