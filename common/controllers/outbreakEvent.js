'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with event related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');
const WorkerRunner = require('./../../components/workerRunner');
const _ = require('lodash');

module.exports = function (Outbreak) {

  /**
   * Attach before remote (GET outbreaks/{id}/events) hooks
   */
  Outbreak.beforeRemote('prototype.findEvents', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context);
    // Enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  /**
   * Find outbreak events
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.findEvents = function (filter, options, callback) {
    filter = filter || {};
    filter.where = filter.where || {};

    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    filter.where = {
      and: [
        filter.where, {
          outbreakId: this.id
        }
      ]
    };

    // make sure we retrieve data needed to determine contacts & exposures
    if (
      countRelations &&
      filter.fields &&
      filter.fields.length > 0 &&
      filter.fields.indexOf('relationshipsRepresentation') < 0
    ) {
      filter.fields.push('relationshipsRepresentation');
    }

    // add geographical restriction to filter if needed
    app.models.event
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        updatedFilter && (filter.where = updatedFilter);

        return app.models.event
          .find(filter);
      })
      .then((records) => {
        if (countRelations) {
          // determine number of contacts/exposures
          app.models.person.getPeopleContactsAndExposures(records);

          // finished
          return callback(null, records);
        } else {
          return callback(null, records);
        }
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/events/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountEvents', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  /**
   * Allows count requests with advanced filters (like the ones we can use on GET requests)
   * to be mode on outbreak/{id}/events.
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountEvents = function (filter, options, callback) {
    // set default filter value
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // check if deep count should be used (this is expensive, should be avoided if possible)
    if (app.utils.remote.searchByRelationProperty.shouldUseDeepCount(filter)) {
      this.findEvents(filter, options, function (err, res) {
        if (err) {
          return callback(err);
        }
        callback(null, app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(res, filter).length);
      });
    } else {
      // add geographical restriction to filter if needed
      return app.models.event
        .addGeographicalRestrictions(options.remotingContext, filter.where)
        .then(updatedFilter => {
          updatedFilter && (filter.where = updatedFilter);

          return app.models.event.rawCountDocuments(filter);
        });
    }
  };

  /**
   * Attach before remote (GET outbreaks/{id}/events/export) hooks
   */
  Outbreak.beforeRemote('prototype.exportFilteredEvents', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    Outbreak.helpers.attachFilterPeopleWithoutRelation(context, modelInstance, next);
  });

  /**
   * Export filtered events to file
   * @param filter Supports MongoDB compatible queries
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredEvents = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

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

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // add geographical restriction to filter if needed
    app.models.event
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // updated filter
        updatedFilter && (filter.where = updatedFilter);

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'person',
            modelName: app.models.event.modelName,
            scopeQuery: app.models.event.definition.settings.scope,
            arrayProps: app.models.event.arrayProps,
            fieldLabelsMap: app.models.event.fieldLabelsMap,
            exportFieldsGroup: app.models.event.exportFieldsGroup,
            exportFieldsOrder: app.models.event.exportFieldsOrder,
            locationFields: app.models.event.locationFields
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get(options, 'accessToken.userId'),
            outbreakId: this.id,
            questionnaire: undefined,
            useQuestionVariable: false,
            useDbColumns,
            dontTranslateValues,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          }
        );
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
   * Retrieve available people for a case
   * @param eventId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getEventRelationshipsAvailablePeople = function (eventId, filter, options, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        eventId,
        filter,
        options
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for an event
   * @param eventId
   * @param where
   * @param options
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipsAvailablePeople = function (eventId, where, options, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        eventId,
        where,
        options
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };
};
