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

  /**
   * Retrieve the list of IDs for the client available outbreaks
   * @param callback
   */
  Sync.getAvailableOutbreaksForClient = function (options, callback) {
    let clientInformation = options.remotingContext.req.authData.client;
    callback(null, {
      outbreakIDs: clientInformation.outbreakIDs || []
    });
  };

  /**
   * Start sync process with a received upstream server
   * @param callback
   */
  Sync.sync = function (data, options, callback) {
    // validate data; check for required upstreamServerURL property in req body
    if (!data.upstreamServerURL || typeof data.upstreamServerURL !== 'string') {
      return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
        errorMessages: 'Missing required property "upstreamServerURL"'
      }));
    }

    // initialize flag to know if the callback function was already called
    // need to do this as we will call it and then continue doing some actions
    let callbackCalled = false;

    // initialize upstreamServer options container
    let upstreamServerEntry;

    // check if the received upstream server URL matches one from the configured upstream servers
    app.models.systemSettings
      .findOne()
      .then(function (systemSettings) {
        // initialize error
        if (!systemSettings) {
          throw app.utils.apiError.getError('INTERNAL_ERROR', {
            error: 'System Settings were not found'
          });
        }

        // find the upstream server entry that matches the received url
        if (!Array.isArray(systemSettings.upstreamServers) || !(upstreamServerEntry = systemSettings.upstreamServers.find(serverEntry => serverEntry.url === data.upstreamServerURL))) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_NOT_CONFIGURED', {
            upstreamServerURL: data.upstreamServerURL
          });
        }

        // upstream server was found; check if sync is enabled
        if (!upstreamServerEntry.syncEnabled) {
          throw app.utils.apiError.getError('UPSTREAM_SERVER_SYNC_DISABLED', {
            upstreamServerName: upstreamServerEntry.name,
            upstreamServerURL: upstreamServerEntry.url
          });
        }

        // start sync with upstream server
        // create syncLog entry in the DB
        return app.models.syncLog.create({
          syncServerUrl: upstreamServerEntry.url,
          syncProcessStartDate: new Date(),
          syncStatus: 'LNG_SYNC_STATUS_IN_PROGRESS'
        }, options);
      })
      .then(function (syncLogEntry) {
        // send response with the syncLogEntry ID
        callback(null, syncLogEntry.id);
        callbackCalled = true;

        // continue sync
        return Sync.getAvailableOutbreaks(upstreamServerEntry);
      })
      .then(function(outbreakIDs) {
        let x = 2;
      })
      .catch(function (err) {
        if(!callbackCalled) {
          callback(err);
          callbackCalled = true;
        } else {
          app.logger.debug(err);
        }
      });
  };
};
