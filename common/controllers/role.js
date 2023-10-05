'use strict';

const app = require('../../server/server');
const Config = require('../../server/config.json');
const WorkerRunner = require('../../components/workerRunner');
const Platform = require('../../components/platform');
const genericHelpers = require('../../components/helpers');
const importableFile = require('../../components/importableFile');
const _ = require('lodash');

// used in role import
const roleImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (Role) {

  // disable methods
  app.utils.remote.disableRemoteMethods(Role, [
    'count',
    'find'
  ]);

  // disable access to principals
  app.utils.remote.disableStandardRelationRemoteMethods(Role, 'principals');

  /**
   * Do not allow deletion of Roles that are in use
   */
  Role.beforeRemote('deleteById', function (context, modelInstance, next) {
    app.models.user
      .find({
        where: {
          roleIds: context.args.id
        }
      })
      .then(function (users) {
        if (users.length) {
          next(app.utils.apiError.getError('MODEL_IN_USE', {model: 'Role', id: context.args.id}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * Do not allow modifying own role
   */
  Role.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.req.authData.user.roleIds.indexOf(context.instance.id) !== -1) {
      return next(app.utils.apiError.getError('MODIFY_OWN_RECORD', {model: 'Role', id: context.instance.id}, 403));
    }
    next();
  });

  /**
   * Get available permissions
   * @param callback
   */
  Role.getAvailablePermissions = function (callback) {
    callback(null, Role.availablePermissions);
  };

  /**
   * Retrieve roles
   * @param filter
   * @param callback
   */
  Role.getRoles = (filter, callback) => {
    app.models.role
      .findAggregate(filter)
      .then((data) => callback(null, data))
      .catch(callback);
  };

  /**
   * Count roles
   * @param where
   * @param callback
   */
  Role.countRoles = (where, callback) => {
    app.models.role
      .findAggregate({ where }, true)
      .then((data) => callback(null, data))
      .catch(callback);
  };

  const attachUsersToRole = function (context, modelInstance, next) {
    if (
      !modelInstance ||
      !modelInstance.id
    ) {
      next();
    } else {
      app.models.user
        .find({
          where: {
            roleIds: {
              inq: [modelInstance.id]
            }
          }
        })
        .then((users) => {
          // users
          if (users) {
            users.forEach((user) => {
              // remove restricted fields
              app.models.user.sanitize(user);
            });

            // attach users
            modelInstance.users = users;
          }

          // finished
          next();
        })
        .catch(next);
    }
  };

  /**
   * Retrieve user data
   */
  Role.afterRemote('findById', attachUsersToRole);
  Role.afterRemote('prototype.patchAttributes', attachUsersToRole);

  /**
   * Export filtered roles to file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Role.exportFilteredUserRoles = function (
    filter,
    exportType,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // export
    WorkerRunner.helpers.exportFilteredModelsList(
      {
        collectionName: 'role',
        modelName: app.models.role.modelName,
        scopeQuery: app.models.role.definition.settings.scope,
        arrayProps: app.models.role.arrayProps,
        fieldLabelsMap: app.models.role.fieldLabelsMap,
        exportFieldsOrder: app.models.role.exportFieldsOrder
      },
      filter,
      exportType,
      undefined,
      anonymizeFields,
      undefined,
      {
        userId: _.get(options, 'accessToken.userId'),
        questionnaire: undefined,
        useQuestionVariable: false,
        useDbColumns,
        dontTranslateValues,
        jsonReplaceUndefinedWithNull,
        contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
      }
    )
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
  };

  /**
   * Import an importable file using file ID and a map to remap parameters
   * @param body
   * @param options
   * @param callback
   */
  Role.importImportableUserRolesFileUsingMap = function (body, options, callback) {
    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // treat the sync as a regular operation, not really a sync
    options._sync = false;

    // inject platform identifier
    options.platform = Platform.IMPORT;

    const createBatchActions = function (batchData) {
      // build a list of sync operations
      const syncRole = [];

      // go through all entries
      batchData.forEach(function (roleItem) {
        syncRole.push(function (asyncCallback) {
          // sync role
          return app.utils.dbSync.syncRecord(app, logger, app.models.role, roleItem.save, options)
            .then(function () {
              asyncCallback();
            })
            .catch(function (error) {
              // on error, store the error, but don't stop, continue with other items
              asyncCallback(null, {
                success: false,
                error: {
                  error: error,
                  data: {
                    file: roleItem.raw,
                    save: roleItem.save
                  }
                }
              });
            });
        });
      });

      return syncRole;
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.role,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.role,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'role',
      batchSize: roleImportBatchSize,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.role.modelName,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };
};
