'use strict';

// requires
const app = require('../server');
const personDuplicate = require('../../components/workerRunner').personDuplicate;
const _ = require('lodash');
const moment = require('moment');

module.exports = function (Person) {

  Person.hasController = false;

  // define a list of custom (non-loopback-supported) relations
  Person.customRelations = {
    relationships: {
      type: 'hasManyEmbedded',
      model: 'relationship',
      foreignKey: 'persons.id'
    },
    // case/contacts have locations
    locations: {
      type: 'belongsToManyComplex',
      model: 'location',
      foreignKeyContainer: 'addresses',
      foreignKey: 'locationId'
    },
    // event has location
    location: {
      type: 'belongsToEmbedded',
      model: 'location',
      foreignKey: 'address.locationId'
    }
  };

  Person.fieldLabelsMap = Object.assign({}, Person.fieldLabelsMap, {
    'firstName': 'LNG_CASE_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CASE_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CASE_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CASE_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CASE_FIELD_LABEL_AGE',
    'age.years': 'LNG_CASE_FIELD_LABEL_AGE_YEARS',
    'age.months': 'LNG_CASE_FIELD_LABEL_AGE_MONTHS',
    'dob': 'LNG_CASE_FIELD_LABEL_DOB',
    'classification': 'LNG_CASE_FIELD_LABEL_CLASSIFICATION',
    'wasContact': 'LNG_CASE_FIELD_LABEL_WAS_CONTACT',
    'dateBecomeCase': 'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
    'wasCase': 'LNG_CONTACT_FIELD_LABEL_WAS_CASE',
    'dateBecomeContact': 'LNG_CONTACT_FIELD_LABEL_DATE_BECOME_CONTACT',
    'dateDeceased': 'LNG_CASE_FIELD_LABEL_DATE_DECEASED',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CASE_FIELD_LABEL_DECEASED',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'isolationDates': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES',
    'hospitalizationDates': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES',
    'incubationDates': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL'
  });

  Person.referenceDataFields = [
    'gender',
    'classification',
    'riskLevel',
    'occupation',
    'documents.type'
  ];

  Person.printFieldsinOrder = [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'occupation',
    'age',
    'dob',
    'classification',
    'wasContact',
    'dateBecomeCase',
    'wasCase',
    'dateBecomeContact',
    'dateDeceased',
    'dateOfInfection',
    'dateOfOnset',
    'phoneNumber',
    'riskLevel',
    'riskReason',
    'dateOfOutcome',
    'deceased',
    'safeBurial',
    'documents',
    'type',
    'isolationDates',
    'hospitalizationDates',
    'incubationDates',
    'transferRefused',
    'addresses'
  ];

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Person.nestedGeoPoints = [
    'addresses[].geoLocation',
    'address.geoLocation'
  ];

  Person.locationFields = [
    'addresses[].locationId',
    'address.locationId'
  ];

  Person.typeToModelMap = {
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'case',
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'contact',
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'event'
  };

  /**
   * Construct and return the display name of the person
   */
  Person.prototype.getDisplayName = function () {
    return Person.getDisplayName(this);
  };

  /**
   * Construct and return the display name of a given person
   * @param person Model or JSON representation
   */
  Person.getDisplayName = function (person) {
    if (person.toJSON) {
      person = person.toJSON();
    }

    // construct display name
    if (person.name) {
      // for events if they have the name set return the name
      return this.name;
    } else {
      // for case/contact return 'firstName middleName lastName'
      return ['firstName', 'middleName', 'lastName'].reduce(function (result, property) {
        if (person[property]) {
          result += (result.length ? ' ' : '') + person[property];
        }
        return result;
      }, '');
    }
  };

  /**
   * Before save hooks
   */
  Person.observe('before save', function (context, next) {
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // if case classification was changed
    if (
      (
        !context.isNewInstance &&
        data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
        && data.source.update
        && data.source.update.classification
        && data.source.existing.classification
        && data.source.existing.classification !== data.source.updated.classification
      ) &&
      (
        // classification changed to/from discarded
        app.models.case.discardedCaseClassifications.includes(data.source.existing.classification) !==
        app.models.case.discardedCaseClassifications.includes(data.source.updated.classification)
      )
    ) {
      // set a flag on context to trigger relationship updated due to significant changes in case classification (from/to discarded case)
      context.options.triggerRelationshipUpdates = true;
    }

    // validate visual ID template
    // get outbreak
    app.models.outbreak
      .findById(data.source.existing.outbreakId)
      .then(function (outbreak) {
        // check for outbreak; should always exist
        if (!outbreak) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.outbreak.modelName,
            id: data.source.existing.outbreakId
          });
        }

        // resolve visual ID
        return app.models.outbreak.helpers
          .resolvePersonVisualIdTemplate(outbreak, data.target.visualId, context.isNewInstance ? null : data.source.existing.id);
      })
      .then(function (resolvedVisualId) {
        data.target.visualId = resolvedVisualId;
        next();
      })
      .catch(next);
  });

  /**
   * After save hooks
   */
  Person.observe('after save', function (ctx, next) {

    // cache instance reference, used in many places below
    let instance = ctx.instance;

    /**
     * When case classification changes, relations need to be notified because they have business logic associated with case classification
     */
    // if a case was updated and relationship updates need to be triggered
    if (!ctx.isNewInstance && instance.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' && ctx.options.triggerRelationshipUpdates) {
      // find all of its relationships with a contact
      app.models.relationship
        .find({
          where: {
            'persons.id': instance.id,
            and: [
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'},
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'}
            ]
          }
        })
        .then(function (relationships) {
          const updateRelationships = [];
          // trigger an update for them (to propagate eventual follow-up period changes)
          relationships.forEach(function (relationship) {
            // nothing to update, just trigger update method to activate the hooks
            updateRelationships.push(relationship.updateAttributes({}, ctx.options));
          });
          // the hook does not need to wait for the changes to propagate
          return Promise.all(updateRelationships);
        })
        .catch(function (err) {
          // log error
          app.logger.error(err);
        });
    }

    // do not wait for the above operations to complete
    return next();
  });


  /**
   * Find or count possible person duplicates
   * @param filter
   * @param [countOnly]
   * @return {Promise<any>}
   */
  Person.findOrCountPossibleDuplicates = function (filter, countOnly) {
    // define default filter
    if (filter == null) {
      filter = {};
    }
    // promisify the response
    return new Promise(function (resolve, reject) {
      let where = filter.where || {};
      // query non deleted records only
      where = {
        $and: [
          {
            $or: [
              {
                deleted: {
                  $ne: true
                }
              },
              {
                deleted: {
                  $exists: false
                }
              }
            ],
          },
          where || {}
        ]
      };
      // use connector directly to bring big number of (raw) results
      app.dataSources.mongoDb.connector.collection('person')
        .find(where)
        .toArray(function (error, people) {
          // handle eventual errors
          if (error) {
            return reject(error);
          }
          let findOrCount;
          if (countOnly) {
            findOrCount = personDuplicate.count.bind(null, people);
          } else {
            findOrCount = personDuplicate.find.bind(null, people, Object.assign({where: where}, filter));
          }
          // find or count duplicate groups
          findOrCount(function (error, duplicates) {
            // handle eventual errors
            if (error) {
              return reject(error);
            }
            // send back the result
            return resolve(duplicates);
          });
        });
    });
  };


  /**
   * Update dateOfLastContact if needed (if conditions are met)
   * @param context
   * @return {*|PromiseLike<T | never>|Promise<T | never>}
   */
  Person.updateDateOfLastContactIfNeeded = function (context) {
    // prevent infinite loops
    if (app.utils.helpers.getValueFromContextOptions(context, 'updateDateOfLastContactIfNeeded')) {
      return Promise.resolve();
    }
    // get person record
    let personRecord = context.instance;
    // find newest person relationship
    return app.models.relationship
      .findOne({
        order: 'contactDate DESC',
        where: {
          'persons.id': personRecord.id,
          active: true
        }
      })
      .then(function (relationshipRecord) {
        let lastContactDate;
        // get last contact date from relationship (if any)
        if (relationshipRecord) {
          lastContactDate = relationshipRecord.contactDate;
        }
        // make sure lastContactDate is a Date
        if (lastContactDate && !(lastContactDate instanceof Date)) {
          lastContactDate = new Date(lastContactDate);
        }
        // make sure dateOfLastContact is a Date
        if (personRecord.dateOfLastContact && !(personRecord.dateOfLastContact instanceof Date)) {
          personRecord.dateOfLastContact = new Date(personRecord.dateOfLastContact);
        }
        // check if there are any differences between date of last contact and last contact date
        if (
          (!personRecord.dateOfLastContact && lastContactDate) ||
          (personRecord.dateOfLastContact && !lastContactDate) ||
          (personRecord.dateOfLastContact && lastContactDate && personRecord.dateOfLastContact.getTime() !== lastContactDate.getTime())
        ) {
          // set a flag for this operation so we prevent infinite loops
          app.utils.helpers.setValueInContextOptions(context, 'updateDateOfLastContactIfNeeded', true);
          // if there are differences, update dateOfLastContact based on lastContactDate
          return personRecord.updateAttributes({
            dateOfLastContact: lastContactDate
          }, context.options);
        }
      });
  };


  /**
   * After save hooks
   */
  Person.observe('after save', function (context, next) {
    // if this is an exiting record
    if (!context.isNewInstance) {
      // update date of last contact, if needed
      Person.updateDateOfLastContactIfNeeded(context)
        .then(function () {
          next();
        })
        .catch(next);
    } else {
      next();
    }
  });

  /**
   * Returns a collection of items that contain a location, and the contacts that are from that location
   * @param personModel
   * @param filter
   * @param outbreak
   * @returns {Promise}
   */
  Person.getPeoplePerLocation = function (personModel, filter, outbreak) {
    // Make function return a promise so we can easily link additional async code
    return new Promise((resolve, reject) => {
      // define outbreak locations filter
      let outbreakLocations;
      // update filter only if outbreak has locations ids defined (otherwise leave it as undefined)
      if (Array.isArray(outbreak.locationIds) && outbreak.locationIds.length) {
        // get outbreak location Ids
        outbreakLocations = outbreak.locationIds;
      }
      // Avoid making secondary request to DB by using a collection of locations instead of an array of locationIds
      app.models.location.getSubLocationsWithDetails(outbreakLocations, [], function (error, allLocations) {
        let allLocationIds = allLocations.map(location => location.id);

        // ReportingGeographicalLevelId should be required in the model schema as well but it is not yet implemented
        // that way because it would be a breaking change.
        if (!outbreak.reportingGeographicalLevelId) {
          reject(app.utils.apiError.getError('MISSING_REQUIRED_PROPERTY', {
            model: app.models.outbreak.modelName,
            properties: 'reportingGeographicalLevelId'
          }));
        }

        // Get all locations that are part of the outbreak's location hierarchy and have the
        // same location level as the outbreak
        app.models.location.find({
          where: {
            and: [
              {
                id: {
                  inq: allLocationIds
                }
              },
              {
                geographicalLevelId: outbreak.reportingGeographicalLevelId
              }
            ]
          }
        })
          .then((reportingLocations) => {
            let reportingLocationIds = reportingLocations.map(location => location.id);
            let locationHierarchy = app.models.location.buildHierarchicalLocationsList(allLocations);
            let locationCorelationMap = {};

            // Initiate peopleDistribution as an object so we can add locations/people to it easier
            let peopleDistribution = {};

            // Start building the peopleDistribution object by adding all reporting locations
            reportingLocations.forEach((location) => {
              peopleDistribution[location.id] = {location: location.toJSON(), people: []};
            });

            // Link lower level locations to their reporting location parent
            app.models.location.createLocationCorelationMap(locationHierarchy, reportingLocationIds, locationCorelationMap);
            let additionalFilter = {};

            if (personModel === 'case') {
              // For cases, we just make sure that the cases are from the required outbreak
              additionalFilter = {
                where: {
                  outbreakId: outbreak.id
                }
              };
            } else {
              let dateInterval = [];

              if (filter && filter.dateOfFollowUp) {
                dateInterval = [moment(filter.dateOfFollowUp).startOf('day'), moment(filter.dateOfFollowUp).endOf('day')];
                delete filter.dateOfFollowUp;
              } else {
                dateInterval = [moment(new Date()).startOf('day'), moment(new Date()).endOf('day')];
              }

              // For contacts, we also need the follow up from either the required date or today so the filter is
              // a bit more complex.
              additionalFilter = {
                where: {
                  outbreakId: outbreak.id
                },
                include: {
                  relation: 'followUps',
                  scope: {
                    where: {
                      date: {
                        between: dateInterval
                      }
                    }
                  }
                },
                order: 'followUp.endDate DESC'
              };
            }
            // Merge the additional filter with the filter provided by the user
            let _filter = app.utils.remote.mergeFilters(additionalFilter, filter || {});

            return app.models[personModel].find(_filter)
              .then(people => [people, locationCorelationMap, peopleDistribution, _filter]);
          })
          .then((results) => {
            let locationCorelationMap = results[1];
            let peopleDistribution = results[2];
            let people = [];

            // We do not apply filterParent logic to contacts because we are interested in the total number of contacts,
            // whether they have follow-ups or not.
            if (personModel === 'case') {
              people = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(results[0], results[3]);
            } else {
              // We force the contacts to be regular objects for easier processing in the future.
              // Cases does not required this step since "deepSearchByRelationProperty" covers this step
              people = results[0].map((contact) => {
                return contact.toJSON();
              });
            }

            // Add the people that pass the filter to their relevant reporting level location
            people.forEach((person) => {
              let personLatestLocation = _.find(person.addresses, ['typeId', 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE']).locationId;
              if (locationCorelationMap[personLatestLocation]) {
                peopleDistribution[locationCorelationMap[personLatestLocation]].people.push(person);
              }
            });

            // After the peopleDistribution object is fully populate it, use only it's values from now on.
            // The keys were used only to easily distribute the locations/people
            resolve(Object.values(peopleDistribution));
          })
          .catch(error);
      });
    });
  };

  /**
   * Get current address for a person
   * @return {*}
   */
  Person.prototype.getCurrentAddress = function () {
    // define current address
    let currentAddress;
    // check if the person has addressed defined
    if (Array.isArray(this.addresses) && this.addresses.length) {
      // get current address
      currentAddress = this.addresses.filter(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE').pop();
    }
    // return current address
    return currentAddress;
  };
};
