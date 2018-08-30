'use strict';

// requires
const fs = require('fs');

module.exports = function (Backup) {
  Backup.hasController = true;

  // list of backup statuses
  Backup.status = {
    SUCCESS: 0,
    FAILED: 1,
    PENDING: 2
  };

  // application modules and their corresponding database collections
  // a module can group one or more collections
  Backup.modules = {
    'System Configuration': [
      'systemSettings',
      'language',
      'languageToken',
      'referenceData',
      'helpCategory'
    ],
    'Data': [
      'template',
      'icon',
      'outbreak',
      'person',
      'labResult',
      'followUp',
      'relationship',
      'team',
      'location',
      'user',
      'role',
      'cluster'
    ]
  };

  /**
   * Check if backup is found or location is ok
   * If so, return the backup entry
   * @param backupId
   * @param done
   */
  Backup.validateAndFetch = function (backupId, done) {
    // get the backup entry, if not found log and stop
    Backup
      .findOne({
        where: {
          id: backupId
        }
      })
      .then((backup) => {
        if (!backup) {
          return done(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.backup.modelName,
            id: backupId
          }));
        }

        // make sure the file is ok
        fs.access(backup.location, fs.FS_OK, (err) => {
          if (err) {
            app.logger.error(`Backup location: ${location} is not OK. ${err}`);
            return done(err);
          }

          return done(backup);
        });
      })
      .catch((err) => done(err));
  };
};
