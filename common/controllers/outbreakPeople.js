'use strict';

const app = require('../../server/server');
const Config = require('../../server/config.json');
const _ = require('lodash');
const localizationHelper = require('../../components/localizationHelper');

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with people related actions
 */

module.exports = function (Outbreak) {
  // private method to generate the disallowed person types filter
  const _generatePersonTypesFilter = function (context) {
    // get the user permissions
    let userPersonTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    // get the disallowed person types
    const disallowedPersonTypes = Outbreak.helpers.getDisallowedPersonTypes(userPersonTypesWithReadAccess);

    // return condition
    return !disallowedPersonTypes.length ?
      {} : {
        where: {
          type: {
            nin: disallowedPersonTypes
          }
        }
      };
  };

  /**
   * Add support for disallowed person types and geo restrictions
   */
  Outbreak.beforeRemote('prototype.__get__people', function (context, modelInstance, next) {
    // merge the disallowed person types filter
    context.args.filter = app.utils.remote.mergeFilters(_generatePersonTypesFilter(context), context.args.filter || {});

    // add geographical restrictions if needed
    app.models.person
      .addGeographicalRestrictions(context, context.args.where)
      .then(updatedFilter => {
        // update where if needed
        updatedFilter && (context.args.where = updatedFilter);

        return next();
      })
      .catch(next);
  });

  /**
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.__get__people', function (context, people, next) {
    const personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    people.forEach((person, index) => {
      person = person.toJSON();
      Outbreak.helpers.limitPersonInformation(person, personTypesWithReadAccess);
      people[index] = person;
    });
    next();
  });

  /**
   * Add support for disallowed person types and geo restrictions
   */
  Outbreak.beforeRemote('prototype.countPeople', function (context, modelInstance, next) {
    // merge the disallowed person types filter
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};
    context.args.filter.where = app.utils.remote.mergeFilters(_generatePersonTypesFilter(context), context.args.filter).where;

    // add geographical restrictions if needed
    app.models.person
      .addGeographicalRestrictions(context, context.args.filter.where)
      .then(updatedFilter => {
        // update where if needed
        updatedFilter && (context.args.filter.where = updatedFilter);

        return next();
      })
      .catch(next);
  });

  /**
   * Count people
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countPeople = function (filter, options, callback) {
    // attach outbreak id
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // count using query
    app.models.person.rawCountDocuments(filter)
      .then(function (count) {
        callback(null, count);
      })
      .catch(callback);
  };

  /**
   * List of contacts/cases where inconsistencies were found between dates.
   * Besides the contact/case properties each entry will also contain an 'inconsistencies' property (array of inconsistencies)
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.listInconsistenciesInKeyDates = function (filter, options, callback) {
    // get outbreakId
    let outbreakId = this.id;
    filter = filter || {};
    app.models.person
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update where if needed
        updatedFilter && (filter.where = updatedFilter);

        // get all the followups for the filtered period
        return app.models.person
          .rawFind(
            app.utils.remote.mergeFilters({
              where: {
                outbreakId: outbreakId,
                // getting only the cases as there are no inconsistencies to check for events and contacts (this was the old logic)
                type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                or: [{
                  $where: `(this.dob && (
                    this.dateOfInfection < this.dob ||
                    this.dateOfOnset < this.dob ||
                    this.dateBecomeCase < this.dob ||
                    this.dateOfOutcome < this.dob
                  )) ||
                  this.dateOfInfection > this.dateOfOnset ||
                  this.dateOfInfection > this.dateBecomeCase ||
                  this.dateOfInfection > this.dateOfOutcome ||
                  this.dateOfOnset > this.dateBecomeCase ||
                  this.dateOfOnset > this.dateOfOutcome ||
                  this.dateBecomeCase > this.dateOfOutcome`,
                }, {
                  // for case: compare dateRanges startDate/endDate for each item in them and against the date of birth
                  $where: `function () {
                  // initialize check result
                  var inconsistencyInKeyDates = false;
                  // get date of birth
                  var dob = this.dob;

                  // loop through the dateRanges and make comparisons
                  var datesContainers = ['dateRanges'];
                  for (var i = 0; i < datesContainers.length; i++) {
                    // check if the datesContainer exists on the model
                    var datesContainer = datesContainers[i];
                    if (this[datesContainer] && this[datesContainer].length) {
                      // loop through the dates; comparison stops at first successful check
                      for (var j = 0; j < this[datesContainer].length; j++) {
                        var dateEntry = this[datesContainer][j];

                        // make sure we have both dates when we compare them
                        if (dateEntry.startDate && dateEntry.endDate) {
                          // compare startDate with endDate
                          inconsistencyInKeyDates = dateEntry.startDate > dateEntry.endDate ? true : false;
                        }

                        // check for dob; both startDate and endDate must be after dob
                        if (!inconsistencyInKeyDates && dob) {
                          if (dateEntry.startDate) {
                            inconsistencyInKeyDates = dateEntry.startDate < dob ? true : false;
                          }
                          if (dateEntry.endDate) {
                            inconsistencyInKeyDates = inconsistencyInKeyDates || (dateEntry.endDate < dob ? true : false);
                          }
                        }

                        // stop checks if an inconsistency was found
                        if (inconsistencyInKeyDates) {
                          break;
                        }
                      }
                    }

                    // stop checks if an inconsistency was found
                    if (inconsistencyInKeyDates) {
                      break;
                    }
                  }

                  return inconsistencyInKeyDates;
                }`
                }]
              }
            }, filter).where
          );
      })
      .then(function (people) {
        // get case fields label map
        let caseFieldsLabelMap = app.models.case.fieldLabelsMap;

        // initialize map of possible inconsistencies operators
        let inconsistenciesOperators = {
          greaterThan: '>',
          lessThan: '<'
        };

        // loop through the people to add the inconsistencies array
        people.forEach(function (person, index) {
          // initialize inconsistencies
          let inconsistencies = [];

          // get dob since it is used in the majority of comparisons
          let dob = person.dob ? localizationHelper.toMoment(person.dob) : null;
          // also get the other dates
          let dateOfInfection = person.dateOfInfection ? localizationHelper.toMoment(person.dateOfInfection) : null;
          let dateOfOnset = person.dateOfOnset ? localizationHelper.toMoment(person.dateOfOnset) : null;
          let dateBecomeCase = person.dateBecomeCase ? localizationHelper.toMoment(person.dateBecomeCase) : null;
          let dateOfOutcome = person.dateOfOutcome ? localizationHelper.toMoment(person.dateOfOutcome) : null;

          // for case:
          if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
            // compare against dob
            if (dob) {
              // dateOfInfection < date of birth
              if (dateOfInfection && dob.isAfter(dateOfInfection)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateOfInfection',
                    label: caseFieldsLabelMap.dateOfInfection
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }

              // dateOfOnset < date of birth
              if (dateOfOnset && dob.isAfter(dateOfOnset)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateOfOnset',
                    label: caseFieldsLabelMap.dateOfOnset
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }

              // dateBecomeCase < date of birth
              if (dateBecomeCase && dob.isAfter(dateBecomeCase)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateBecomeCase',
                    label: caseFieldsLabelMap.dateBecomeCase
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }

              // dateOfOutcome < date of birth
              if (dateOfOutcome && dob.isAfter(dateOfOutcome)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateOfOutcome',
                    label: caseFieldsLabelMap.dateOfOutcome
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }
            }

            // compare dateOfInfection, dateOfOnset, dateBecomeCase, dateOfOutcome
            // dateOfInfection > dateOfOnset
            if (dateOfInfection && dateOfOnset && dateOfInfection.isAfter(dateOfOnset)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfInfection',
                  label: caseFieldsLabelMap.dateOfInfection
                }, {
                  field: 'dateOfOnset',
                  label: caseFieldsLabelMap.dateOfOnset
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfInfection > dateBecomeCase
            if (dateOfInfection && dateBecomeCase && dateOfInfection.isAfter(dateBecomeCase)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfInfection',
                  label: caseFieldsLabelMap.dateOfInfection
                }, {
                  field: 'dateBecomeCase',
                  label: caseFieldsLabelMap.dateBecomeCase
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfInfection > dateOfOutcome
            if (dateOfInfection && dateOfOutcome && dateOfInfection.isAfter(dateOfOutcome)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfInfection',
                  label: caseFieldsLabelMap.dateOfInfection
                }, {
                  field: 'dateOfOutcome',
                  label: caseFieldsLabelMap.dateOfOutcome
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfOnset > dateBecomeCase
            if (dateOfOnset && dateBecomeCase && dateOfOnset.isAfter(dateBecomeCase)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfOnset',
                  label: caseFieldsLabelMap.dateOfOnset
                }, {
                  field: 'dateBecomeCase',
                  label: caseFieldsLabelMap.dateBecomeCase
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfOnset > dateOfOutcome
            if (dateOfOnset && dateOfOutcome && dateOfOnset.isAfter(dateOfOutcome)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfOnset',
                  label: caseFieldsLabelMap.dateOfOnset
                }, {
                  field: 'dateOfOutcome',
                  label: caseFieldsLabelMap.dateOfOutcome
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateBecomeCase > dateOfOutcome
            if (dateBecomeCase && dateOfOutcome && dateBecomeCase.isAfter(dateOfOutcome)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateBecomeCase',
                  label: caseFieldsLabelMap.dateBecomeCase
                }, {
                  field: 'dateOfOutcome',
                  label: caseFieldsLabelMap.dateOfOutcome
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // compare dateRanges startDate/endDate for each item in them and against the date of birth
            // loop through the dateRanges and make comparisons
            var datesContainers = ['dateRanges'];
            datesContainers.forEach(function (datesContainer) {
              if (person[datesContainer] && person[datesContainer].length) {
                // loop through the dates to find inconsistencies
                person[datesContainer].forEach(function (dateEntry, dateEntryIndex) {
                  // get startDate and endDate
                  let startDate = dateEntry.startDate ? localizationHelper.toMoment(dateEntry.startDate) : null;
                  let endDate = dateEntry.endDate ? localizationHelper.toMoment(dateEntry.endDate) : null;

                  // compare startDate with endDate
                  if (
                    startDate &&
                    endDate &&
                    startDate.isAfter(endDate)
                  ) {
                    inconsistencies.push({
                      dates: [{
                        field: `${datesContainer}.${dateEntryIndex}.startDate`,
                        label: caseFieldsLabelMap[`${datesContainer}[].startDate`],
                        dateRangeType: dateEntry.typeId
                      }, {
                        field: `${datesContainer}.${dateEntryIndex}.endDate`,
                        label: caseFieldsLabelMap[`${datesContainer}[].endDate`],
                        dateRangeType: dateEntry.typeId
                      }],
                      issue: inconsistenciesOperators.greaterThan
                    });
                  }

                  // check for dob; both startDate and endDate must be after dob
                  if (dob) {
                    if (
                      startDate &&
                      dob.isAfter(startDate)
                    ) {
                      inconsistencies.push({
                        dates: [{
                          field: 'dob',
                          label: caseFieldsLabelMap.dob
                        }, {
                          field: `${datesContainer}.${dateEntryIndex}.startDate`,
                          label: caseFieldsLabelMap[`${datesContainer}[].startDate`],
                          dateRangeType: dateEntry.typeId
                        }],
                        issue: inconsistenciesOperators.greaterThan
                      });
                    }

                    if (
                      endDate &&
                      dob.isAfter(endDate)
                    ) {
                      inconsistencies.push({
                        dates: [{
                          field: 'dob',
                          label: caseFieldsLabelMap.dob
                        }, {
                          field: `${datesContainer}.${dateEntryIndex}.endDate`,
                          label: caseFieldsLabelMap[`${datesContainer}[].endDate`],
                          dateRangeType: dateEntry.typeId
                        }],
                        issue: inconsistenciesOperators.greaterThan
                      });
                    }
                  }

                });
              }
            });
          }

          // add inconsistencies in the person entry
          people[index].inconsistencies = inconsistencies;
        });

        // send response
        callback(null, people);
      })
      .catch(callback);
  };

  /**
   * Find possible person duplicates
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.findPossiblePersonDuplicates = function (filter, options, callback) {
    // define default filter
    if (filter == null) {
      filter = {};
    }
    // get where filter (this needs to be mongoDB compliant where, not loopback, because we're using raw queries)
    let where = filter.where || {};
    // merge-in outbreakId
    where = {
      $and: [{
        outbreakId: this.id
      }, where]
    };
    // find possible person duplicates groups
    app.models.person
      .findOrCountPossibleDuplicates(Object.assign({where: where}, filter), false, options)
      .then(function (duplicates) {
        // send back result set
        callback(null, duplicates);
      })
      .catch(callback);
  };


  /**
   * Count possible person duplicates
   * @param where
   * @param options
   * @param callback
   */
  Outbreak.prototype.countPossiblePersonDuplicates = function (where, options, callback) {
    // get where filter (this needs to be mongoDB compliant where, not loopback, because we're using raw queries)
    where = where || {};
    // merge-in outbreakId
    where = {
      $and: [{
        outbreakId: this.id
      }, where]
    };
    // find possible person duplicates groups
    app.models.person
      .findOrCountPossibleDuplicates({where: where}, true, options)
      .then(function (duplicatesNo) {
        callback(null, duplicatesNo);
      })
      .catch(callback);
  };

  /**
   * Get possible person duplicates
   *
   * @param model
   * @param options
   * @param callback
   */
  Outbreak.prototype.getPersonPossibleDuplicates = function (model = {}, options, callback) {
    const types = [];

    // get context
    const context = _.get(options, 'remotingContext');

    // check cases permissions
    if (
      (
        !Config.duplicate ||
        !Config.duplicate.disableCaseDuplicateCheck
      ) && (
        context.req.authData.user.permissionsList.indexOf('case_list') >= 0 ||
        context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['case_list'].groupAllId) >= 0
      )
    ) {
      types.push('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE');
    }

    // check contacts permissions
    if (
      (
        !Config.duplicate ||
        !Config.duplicate.disableContactDuplicateCheck
      ) && (
        context.req.authData.user.permissionsList.indexOf('contact_list') >= 0 ||
        context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['contact_list'].groupAllId) >= 0
      )
    ) {
      types.push('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');
    }

    // check contacts of contacts permissions
    if (
      (
        !Config.duplicate ||
        !Config.duplicate.disableContactOfContactDuplicateCheck
      ) && (
        context.req.authData.user.permissionsList.indexOf('contact_of_contact_list') >= 0 ||
        context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['contact_of_contact_list'].groupAllId) >= 0
      )
    ) {
      types.push('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT');
    }

    // check if there are persons to retrieve
    if (types.length === 0) {
      callback(null, []);
    } else {
      app.models.person
        .findDuplicatesByType(this.id, types, model, options)
        .then(duplicates => callback(null, duplicates))
        .catch(callback);
    }
  };
};
