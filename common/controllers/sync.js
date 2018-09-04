'use strict';

const fs = require('fs');
const formidable = require('formidable');
const app = require('../../server/server');
const dbSync = require('../../components/dbSync');

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

    // for mobile list of collections that are exported is restricted
    let collections = Object.keys(dbSync.collectionsMap);
    if (filter.mobile) {
      let excludedCollections = [
        'systemSettings',
        'template',
        'icon',
        'helpCategory'
      ];
      collections = collections.filter((collection) => excludedCollections.indexOf(collection) === -1);
    }

    Sync.exportDatabase(
      filter,
      collections,
      // no collection specific options
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
        return done(err);
      }

      // validates snapshot archive
      if (!files.snapshot) {
        // send back the error
        return done(buildError('MISSING_REQUIRED_PROPERTY', {
          model: Sync.modelName,
          properties: 'snapshot'
        }));
      }

      // build request context manually, because there is no logged user in action
      let requestOptions = {
        remotingContext: {
          req: {
            authData: {
              user: {
                id: req.clientId,
                roles: [
                  {
                    name: app.models.role.clientApplicationPermission
                  }
                ]
              }
            },
            headers: req.headers,
            connection: req.connection
          }
        }
      };

      // extract the archive to the temporary directory
      Sync.syncDatabaseWithSnapshot(files.snapshot.path, requestOptions, done);
    });
  };
};
