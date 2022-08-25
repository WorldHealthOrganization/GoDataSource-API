'use strict';

const app = require( '../../server/server' );
const _ = require( 'lodash' );
const WorkerRunner = require( './../../components/workerRunner' );
const exportHelper = require( './../../components/exportHelper' );

module.exports = function (AuditLog) {

  // Audit Log has only read-only endpoints
  app.utils.remote.disableRemoteMethods(AuditLog, [
    'create',
    'prototype.patchAttributes',
    'findById',
    'deleteById',
    'prototype.__get__user'
  ] );
  
  /**
   * Export filtered cases to file
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  AuditLog.exportFilteredAuditLogs = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    options,
    callback
  )
  {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useDbColumns query param
    let useDbColumns = false;
    if ( filter.where.hasOwnProperty( 'useDbColumns' ) )
    {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if ( filter.where.hasOwnProperty( 'dontTranslateValues' ) )
    {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if ( filter.where.hasOwnProperty( 'jsonReplaceUndefinedWithNull' ) )
    {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // if encrypt password is not valid, remove it
    if ( typeof encryptPassword !== 'string' || !encryptPassword.length )
    {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if ( !Array.isArray( anonymizeFields ) )
    {
      anonymizeFields = [];
    }

    // export
    WorkerRunner.helpers.exportFilteredModelsList(
      {
        collectionName: 'auditLog',
        modelName: app.models.auditLog.modelName,
        scopeQuery: app.models.auditLog.definition.settings.scope,
        excludeBaseProperties: app.models.auditLog.definition.settings.excludeBaseProperties,
        arrayProps: app.models.auditLog.arrayProps,
        fieldLabelsMap: app.models.auditLog.fieldLabelsMap
      },
      filter,
      exportType,
      encryptPassword,
      anonymizeFields,
      undefined,
      {
        userId: _.get( options, 'accessToken.userId' ),
        useDbColumns,
        dontTranslateValues,
        jsonReplaceUndefinedWithNull,
        contextUserLanguageId: app.utils.remote.getUserFromOptions( options ).languageId
      },
      undefined,
      {
        user: {
          type: exportHelper.RELATION_TYPE.HAS_ONE,
          collection: 'user',
          project: [
            '_id',
            'firstName',
            'lastName',
            'email'
          ],
          key: '_id',
          keyValue: `(auditLog) => {
            return auditLog && auditLog.userId ?
              auditLog.userId :
              undefined;
          }`,
          // #TODO: User properties not translated, please investigate
          replace: {
            'userId': {
              value: 'user'
            }
          }
        },
      }
    )
      .then( ( exportData ) =>
      {
        // send export id further
        callback(
          null,
          exportData
        );
      } )
      .catch( callback );
  };
};
