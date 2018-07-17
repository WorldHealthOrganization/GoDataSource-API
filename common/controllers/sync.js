'use strict';

const fs = require('fs');
const formidable = require('formidable');
const app = require('../../server/server');

module.exports = function (Sync) {
  /**
   * Retrieve a compressed snapshot of the database
   * Date filter is supported ({ fromDate: Date })
   * @param filter
   * @param done
   */
  Sync.getDatabaseSnapshot = function (filter, done) {
    filter = filter || {};
    filter.where = filter.where || {};

    Sync.exportDatabase(
      filter,
      [
        'systemSettings',
        'template',
        'icon',
        'helpCategory'
      ],
      [],
      (err, fileName) => {
        if (err) {
          return done(err);
        }
        return done(null, fs.createReadStream(fileName), 'application/octet-stream');
    });
  };

  /**
   * Synchronize database based on a given snapshot archive containing matching collections
   * @param req
   * @param snapshot Database snapshot .tar.gz archive
   * @param done
   */
  Sync.importDatabaseSnapshot = function (req, snapshot, done) {
    const buildError = app.utils.apiError.getError;
    const form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
      if (err) {
        return done(error);
      }

      // validates snapshot archive
      if (!files.snapshot) {
        // send back the error
        return done(buildError('MISSING_REQUIRED_PROPERTY', {
          model: Sync.modelName,
          properties: 'snapshot'
        }));
      }
      // validate that the archive is a .tar.gz
      if (files.snapshot.type !== 'application/gzip') {
        return done(buildError('INVALID_SNAPSHOT_FILE'));
      }

      // extract the archive to the temporary directory
      Sync.extractDatabaseArchive(files.snapshot.path, done);
    });
  };
};
