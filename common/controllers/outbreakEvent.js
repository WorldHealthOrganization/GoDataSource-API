'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with event related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');

module.exports = function (Outbreak) {

  /**
   * Attach before remote (GET outbreaks/{id}/events) hooks
   */
  Outbreak.beforeRemote('prototype.findEvents', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context);
    // Enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context, modelInstance, next);
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

    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context, modelInstance, next);
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
