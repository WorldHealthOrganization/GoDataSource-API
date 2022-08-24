'use strict';

const app = require( '../../server/server' );
const _ = require( 'lodash' );
const WorkerRunner = require( './../../components/workerRunner' );

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
  AuditLog.prototype.exportFilteredAuditLogs = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  )
  {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // parse includeContactFields query param
    let includeContactFields = false;
    if ( filter.where.hasOwnProperty( 'includeContactFields' ) )
    {
      includeContactFields = filter.where.includeContactFields;
      delete filter.where.includeContactFields;
    }

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    if ( filter.where.hasOwnProperty( 'useQuestionVariable' ) )
    {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

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

    // #FIXME: May not be needed
    // prefilters
    // const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
    //   filter, {
    //   outbreakId: this.id
    // }, {
    //   relationship: {
    //     collection: 'relationship',
    //     queryPath: 'where.relationship',
    //     localKey: '_id',
    //     foreignKey: 'persons[].id',
    //     foreignKeyArraySize: 2
    //   },
    //   labResult: {
    //     collection: 'labResult',
    //     queryPath: 'where.labResult',
    //     localKey: '_id',
    //     foreignKey: 'personId'
    //   }
    // }
    // );

    // do we need to include contact data in case exported data if case was a contact ?
    let additionalFieldsToExport;
    if ( includeContactFields )
    {
      // initialize additional fields to export
      additionalFieldsToExport = {
        fields: {},
        arrayProps: {},
        locationFields: []
      };

      // determine case fields
      const caseFields = {};
      _.each(
        app.models.case.fieldLabelsMap,
        ( caseFieldToken, caseField ) =>
        {
          // should exclude or include ?
          let shouldExclude = false;
          if ( app.models.case.definition.settings.excludeBaseProperties )
          {
            for ( let index = 0; index < app.models.case.definition.settings.excludeBaseProperties.length; index++ )
            {
              let excludedField = app.models.case.definition.settings.excludeBaseProperties[index];
              if (
                caseField === excludedField ||
                caseField.startsWith( `${ excludedField }.` ) ||
                caseField.startsWith( `${ excludedField }[]` )
              )
              {
                // must exclude field
                shouldExclude = true;

                // no need to check further
                break;
              }
            }
          }

          // should exclude or include field ?
          if ( !shouldExclude )
          {
            caseFields[caseField] = caseFieldToken;
          }
        }
      );

      // determine contact fields
      const contactFields = {};
      _.each(
        app.models.contact.fieldLabelsMap,
        ( contactFieldToken, contactField ) =>
        {
          // should exclude or include ?
          let shouldExclude = false;
          if ( app.models.contact.definition.settings.excludeBaseProperties )
          {
            for ( let index = 0; index < app.models.contact.definition.settings.excludeBaseProperties.length; index++ )
            {
              let excludedField = app.models.contact.definition.settings.excludeBaseProperties[index];
              if (
                contactField === excludedField ||
                contactField.startsWith( `${ excludedField }.` ) ||
                contactField.startsWith( `${ excludedField }[]` )
              )
              {
                // must exclude field
                shouldExclude = true;

                // no need to check further
                break;
              }
            }
          }

          // should exclude or include field ?
          if ( !shouldExclude )
          {
            contactFields[contactField] = contactFieldToken;
          }
        }
      );

      // determine what fields from contact are missing from case
      _.each(
        contactFields,
        ( contactFieldToken, contactField ) =>
        {
          if ( !caseFields[contactField] )
          {
            // add field
            additionalFieldsToExport.fields[contactField] = contactFieldToken;

            // is array property ?
            if ( app.models.contact.arrayProps[contactField] )
            {
              additionalFieldsToExport.arrayProps[contactField] = app.models.contact.arrayProps[contactField];
            }

            // is location property ?
            if ( app.models.contact.locationFields.indexOf( contactField ) > -1 )
            {
              additionalFieldsToExport.locationFields.push( contactField );
            }
          }
        }
      );
    }

    // prefilter
    app.models.case
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then( updatedFilter =>
      {
        // update casesQuery if needed
        updatedFilter && ( filter.where = updatedFilter );

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'person',
            modelName: app.models.case.modelName,
            scopeQuery: app.models.case.definition.settings.scope,
            excludeBaseProperties: app.models.case.definition.settings.excludeBaseProperties,
            arrayProps: app.models.case.arrayProps,
            fieldLabelsMap: app.models.case.fieldLabelsMap,
            exportFieldsGroup: app.models.case.exportFieldsGroup,
            exportFieldsOrder: app.models.case.exportFieldsOrder,
            locationFields: app.models.case.locationFields,
            additionalFieldsToExport
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get( options, 'accessToken.userId' ),
            outbreakId: this.id,
            questionnaire: this.caseInvestigationTemplate ?
              this.caseInvestigationTemplate.toJSON() :
              undefined,
            useQuestionVariable,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions( options ).languageId
          }
          // prefilters
        );
      } )
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
