'use strict';

const app = require('../../server/server');
const Config = require('../../server/config.json');
const genericHelpers = require('../../components/helpers');
const importableFile = require('../../components/importableFile');
const WorkerRunner = require('../../components/workerRunner');
const Platform = require('../../components/platform');
const _ = require('lodash');
const exportHelper = require('../../components/exportHelper');

// used in team import
const teamImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (Team) {

  // disable unneeded methods
  app.utils.remote.disableRemoteMethods(Team, [
    'prototype.__create__followUps',
    'prototype.__delete__followUps',
    'prototype.__updateById__followUps',
    'prototype.__destroyById__followUps'
  ]);

  /**
   * Do not allow deletion of teams that are currently in use
   * A team is in use if it has current or future follow-ups assigned
   */
  Team.beforeRemote('deleteById', function (context, modelInstance, next) {
    const today = new Date();
    today.setHours(0,0,0,0);
    app.models.followUp
      .count({
        teamId: context.args.id,
        date: {
          gte: today
        }
      })
      .then(function (count) {
        if (count) {
          throw app.utils.apiError.getError('MODEL_IN_USE', {model: Team.modelName, id: context.args.id});
        }
        next();
      })
      .catch(next);
  });

  /**
   * Filter by parent location
   */
  Team.beforeRemote('**', function (context, modelInstance, next) {
    if (context.args.filter) {
      genericHelpers.includeSubLocationsInLocationFilter(
        app,
        context.args.filter,
        'locationIds',
        next
      );
    } else if (context.args.where) {
      genericHelpers.includeSubLocationsInLocationFilter(
        app, {
          where: context.args.where
        },
        'locationIds',
        next
      );
    } else {
      return next();
    }
  });

  /**
   * Export filtered teams to file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Team.exportFilteredTeams = function (
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
        collectionName: 'team',
        modelName: app.models.team.modelName,
        scopeQuery: app.models.team.definition.settings.scope,
        arrayProps: app.models.team.arrayProps,
        fieldLabelsMap: app.models.team.fieldLabelsMap,
        exportFieldsOrder: app.models.team.exportFieldsOrder
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
      },
      undefined, {
        userIds: {
          type: exportHelper.RELATION_TYPE.HAS_MANY,
          collection: 'user',
          project: [
            '_id',
            'firstName',
            'lastName',
            'email'
          ],
          key: '_id',
          keyValues: `(item) => {
            return item && item.userIds ?
              item.userIds :
              undefined;
          }`,
          format: `(item, dontTranslateValues) => {
            return dontTranslateValues ?
              item.id :
              (
                [item.firstName, item.lastName].filter(Boolean).join(' ').trim() +
                ' ( ' +
                item.email +
                ' )'
              )
          }`
        },
        locationIds: {
          type: exportHelper.RELATION_TYPE.HAS_MANY,
          collection: 'location',
          project: [
            '_id',
            'name'
          ],
          key: '_id',
          keyValues: `(item) => {
            return item && item.locationIds ?
              item.locationIds :
              undefined;
          }`,
          format: `(item, dontTranslateValues) => {
            return dontTranslateValues ?
              item.id :
              item.name;
          }`
        }
      })
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
  Team.importImportableTeamsFileUsingMap = function (body, options, callback) {
    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // treat the sync as a regular operation, not really a sync
    options._sync = false;

    // inject platform identifier
    options.platform = Platform.IMPORT;

    const createBatchActions = function (batchData) {
      // build a list of sync operations
      const syncTeam = [];

      // go through all entries
      batchData.forEach(function (teamItem) {
        syncTeam.push(function (asyncCallback) {
          // sync team
          return app.utils.dbSync.syncRecord(app, logger, app.models.team, teamItem.save, options)
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
                    file: teamItem.raw,
                    save: teamItem.save
                  }
                }
              });
            });
        });
      });

      return syncTeam;
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.team,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.team,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'team',
      batchSize: teamImportBatchSize,
      modelBooleanProperties: modelBooleanProperties,
      modelDateProperties: modelDateProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.team.modelName,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };
};
