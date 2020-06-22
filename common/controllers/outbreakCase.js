'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with case related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');

module.exports = function (Outbreak) {
  /**
   * Attach before remote (GET outbreaks/{id}/cases/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountCases', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountCases', (context, modelInstance, next) => {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    Outbreak.helpers.findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Count outbreak cases
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountCases = function (filter, options, callback) {
    // pre-filter using related data (case)
    app.models.case
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // fix for some filter options received from web ( e.g $elemMatch search in array properties )
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // replace nested geo points filters
        app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.case,
          filter.where,
          true,
          undefined,
          true
        );

        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);

        // count using query
        return app.models.case.count(filter.where);
      })
      .then(function (cases) {
        callback(null, cases);
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/cases) hooks
   */
  Outbreak.beforeRemote('prototype.findCases', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context);
    // enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation(
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
      context,
      modelInstance,
      next
    );
  });

  /**
   * Ensure backwards compatibility of the received filter
   */
  Outbreak.beforeRemote('prototype.findCases', (context, modelInstance, next) => {
    Outbreak.helpers.findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak cases
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.findCases = function (filter, options, callback) {
    const outbreakId = this.outbreakId;
    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    // pre-filter using related data (case)
    app.models.case
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // fix for some filter options received from web ( e.g $elemMatch search in array properties )
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // replace nested geo points filters
        app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.case,
          filter.where,
          true
        );

        // find cases using filter
        return app.models.case.find(filter);
      })
      .then(function (cases) {
        if (countRelations) {
          // create a map of ids and their corresponding record
          // to easily manipulate the records below
          const casesMap = {};
          for (let record of cases) {
            casesMap[record.id] = record;
          }
          // determine number of contacts/exposures for each case
          app.models.person.getPeopleContactsAndExposures(outbreakId, Object.keys(casesMap))
            .then(relationsCountMap => {
              for (let recordId in relationsCountMap) {
                const caseRecord = casesMap[recordId];
                caseRecord.numberOfContacts = relationsCountMap[recordId].numberOfContacts;
                caseRecord.numberOfExposures = relationsCountMap[recordId].numberOfExposures;
              }
              return callback(null, cases);
            });
        } else {
          return callback(null, cases);
        }
      })
      .catch(callback);
  };
};
