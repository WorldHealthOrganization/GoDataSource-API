'use strict';

// requires
const app = require('../server');
const personDuplicate = require('../../components/workerRunner').personDuplicate;
const helpers = require('../../components/helpers');
const _ = require('lodash');

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
    },
    // date range locations
    dateRangeLocations: {
      type: 'belongsToManyComplex',
      model: 'location',
      foreignKeyContainer: 'dateRanges',
      foreignKey: 'locationId'
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
    'dateRanges': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES',//
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
    'dateRanges',
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
    'dateRanges[].locationId',
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
   * Basic person address validation
   * @param personInstance
   * @return {*}
   */
  function validatePersonAddresses(personInstance) {
    // keep validation error
    let error;
    // if the person has addresses defined
    if (Array.isArray(personInstance.addresses) && personInstance.addresses.length) {
      // keep a list of current (usual place of residence) addresses
      const currentAddresses = [];
      // keep a list of previous (previous usual place of residence) addresses
      const previousAddressesWithoutDate = [];
      // go through the addresses
      personInstance.addresses.forEach(function (address) {
        // store usual place of residence
        if (address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE') {
          currentAddresses.push(address);
          // store previous addresses without dates
        } else if (address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_PREVIOUS_USUAL_PLACE_OF_RESIDENCE' && !address.date) {
          previousAddressesWithoutDate.push(address);
        }
      });
      // check if there is a current address set
      if (!currentAddresses.length) {
        error = app.utils.apiError.getError('ADDRESS_MUST_HAVE_USUAL_PLACE_OF_RESIDENCE', {
          addresses: personInstance.addresses
        });
        // check if there are more current addresses set
      } else if (currentAddresses.length > 1) {
        error = app.utils.apiError.getError('ADDRESS_MULTIPLE_USUAL_PLACE_OF_RESIDENCE', {
          addresses: personInstance.addresses,
          usualPlaceOfResidence: currentAddresses
        });
        // check if there are previous addresses without date
      } else if (previousAddressesWithoutDate.length) {
        error = app.utils.apiError.getError('ADDRESS_PREVIOUS_PLACE_OF_RESIDENCE_MUST_HAVE_DATE', {
          addresses: personInstance.addresses,
          previousUsualPlaceOfResidence: previousAddressesWithoutDate
        });
      }
    }
    return error;
  }

  /**
   * Before save hooks
   */
  Person.observe('before save', function (context, next) {
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // if the record is not being deleted or this is not a system triggered update
    if (!data.source.all.deleted && !data.source.all.systemTriggeredUpdate) {
      // validate person addresses
      const addressValidationError = validatePersonAddresses(data.source.all);
      // if there is an address validation error
      if (addressValidationError) {
        // stop with error
        return next(addressValidationError);
      }
    }
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

    // check if visual id should be validated (validation can be disabled under certain conditions)
    const validateVisualId = !_.get(context, 'options._disableVisualIdValidation', false);

    // if validation is enabled
    if (validateVisualId) {
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
    } else {
      // validation disabled
      next();
    }
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
        if (error) {
          reject(error);
        }
        let allLocationIds = allLocations.map(location => location.id);

        // ReportingGeographicalLevelId should be required in the model schema as well but it is not yet implemented
        // that way because it would be a breaking change.
        if (!outbreak.reportingGeographicalLevelId) {
          reject(app.utils.apiError.getError('MISSING_REQUIRED_PROPERTY', {
            model: app.models.outbreak.modelName,
            properties: 'reportingGeographicalLevelId'
          }));
        }

        let _filter;

        // Get all locations that are part of the outbreak's location hierarchy and have the
        // same location level as the outbreak
        app.models.location
          .rawFind({
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
          })
          .then((reportingLocations) => {
            let reportingLocationIds = reportingLocations.map(location => location.id);
            let locationHierarchy = app.models.location.buildHierarchicalLocationsList(allLocations);
            let locationCorelationMap = {};

            // Initiate peopleDistribution as an object so we can add locations/people to it easier
            let peopleDistribution = {};

            // Start building the peopleDistribution object by adding all reporting locations
            reportingLocations.forEach((location) => {
              peopleDistribution[location.id] = {location: location, people: []};
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

              if (filter) {
                if (filter.dateOfFollowUp) {
                  dateInterval = [helpers.getDate(filter.dateOfFollowUp), helpers.getDateEndOfDay(filter.dateOfFollowUp)];
                  delete filter.dateOfFollowUp;
                } else if (filter.startDate && filter.endDate) {
                  dateInterval = [helpers.getDate(filter.startDate), helpers.getDateEndOfDay(filter.endDate)];
                }
              } else {
                dateInterval = [helpers.getDate(), helpers.getDateEndOfDay()];
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
                }
              };
            }
            // Merge the additional filter with the filter provided by the user
            _filter = app.utils.remote.mergeFilters(additionalFilter, filter || {});

            return app.models[personModel].rawFind(_filter.where, {order: {'followUp.endDate': -1}})
              .then(people => [people, locationCorelationMap, peopleDistribution, _filter]);
          })
          .then((results) => {
            let locationCorelationMap = results[1];
            let peopleDistribution = results[2];

            return new Promise(function (resolve) {
              // We do not apply filterParent logic to contacts because we are interested in the total number of contacts,
              // whether they have follow-ups or not.
              if (personModel === 'case') {
                resolve(app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(results[0], results[3]));
              } else {
                // build a map of people
                let peopleMap = {};
                results[0].forEach(function (person) {
                  peopleMap[person.id] = person;
                  person.followUps = [];
                });

                // get follow-up query
                let query = app.utils.remote.searchByRelationProperty
                  .convertIncludeQueryToFilterQuery(_filter, {}, false);

                // find followUps for those people
                return app.models.followUp
                  .rawFind({
                    and: [
                      {
                        personId: {
                          inq: Object.keys(peopleMap)
                        },
                        outbreakId: outbreak.id,
                      },
                      query.followUps
                    ]
                  })
                  .then(function (followUps) {
                    // map follow-ups back to people
                    followUps.forEach(function (followUp) {
                      peopleMap[followUp.personId].followUps.push(followUp);
                    });
                    // return the list of people
                    resolve(Object.values(peopleMap));
                  });
              }
            })
              .then(function (people) {
                // Add the people that pass the filter to their relevant reporting level location
                people.forEach((person) => {
                  // get current person address
                  const personCurrentAddress = Person.getCurrentAddress(person);
                  // define current person location
                  let personCurrentLocation;
                  // if the person has a current address
                  if (personCurrentAddress) {
                    // get it's location
                    personCurrentLocation = personCurrentAddress.locationId;
                  }
                  // if it has a current location, get it's correlated location
                  if (personCurrentLocation && locationCorelationMap[personCurrentLocation]) {
                    peopleDistribution[locationCorelationMap[personCurrentLocation]].people.push(person);
                  }
                });

                // After the peopleDistribution object is fully populate it, use only it's values from now on.
                // The keys were used only to easily distribute the locations/people
                resolve(Object.values(peopleDistribution).filter(entry => entry.people.length));
              });
          })
          .catch(error);
      });
    });
  };

  /**
   * Get current address from an object (not a person instance)
   * @param person
   * @returns {*}
   */
  Person.getCurrentAddress = function (person) {
    // define current address
    let currentAddress;
    // check if the person has addressed defined
    if (Array.isArray(person.addresses) && person.addresses.length) {
      // get current address
      currentAddress = person.addresses.filter(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE').pop();
    }
    // return current address
    return currentAddress;
  };

  /**
   * Get current address for a person instance
   * @return {*}
   */
  Person.prototype.getCurrentAddress = function () {
    Person.getCurrentAddress(this);
  };

  /**
   * Return the movement of a person.
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @returns {Promise<Array | never>}
   */
  Person.prototype.getMovement = function () {
    // start with empty movement
    let movement = [];
    // if the person has addresses defined
    if (Array.isArray(this.addresses) && this.addresses.length) {
      // keep only addresses that have geo-location information
      movement = this.addresses.filter(address => !!address.geoLocation);
      // sort them by date, in asc order (addresses without date are treated as most recent)
      movement.sort(function (a, b) {
        if (!a.date && b.date) {
          return 1;
        } else if (a.date && !b.date) {
          return -1;
        } else if (!a.date && !b.date) {
          return 0;
        } else {
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        }
      });
    }
    // resolve locations
    const getLocations = [];
    // go through address list
    movement.forEach(function (address) {
      // if the location has an address
      if (address.locationId) {
        // get it
        getLocations.push(app.models.location
          .findById(address.locationId)
          .then(function (location) {
            // add it to the address
            address.location = location;
          }));
      }
    });
    // get locations for addresses
    return Promise.all(getLocations)
      .then(function () {
        return movement;
      });
  };

  /**
   * Find duplicates entries in database based on hardcoded rules
   * @param filter Pagination props (skip, limit)
   * @param outbreakId Outbreak id, used to narrow the searches
   * @param type Contact/Case
   * @param targetBody Target body properties (this is used for checking duplicates)
   */
  Person.findDuplicatesByType = function (filter, outbreakId, type, targetBody) {
    const buildRuleFilterPart = function (opts) {
      let filter = {
        $and: []
      };
      for (let prop in opts) {
        filter.$and.push({
          $and: [
            {
              // we don't do non-exist values
              [prop]: {
                $ne: null
              }
            },
            {
              // we do exact matches for now
              [prop]: opts[prop]
            }
          ]
        });
      }
      return filter;
    };
    const query = {
      outbreakId: outbreakId,
      type: type,
      $or: []
    };

    if (targetBody.firstName && targetBody.lastName) {
      query.$or.push(
        buildRuleFilterPart({
          firstName: targetBody.firstName,
          lastName: targetBody.lastName
        }),
        // also do reverse checks
        buildRuleFilterPart({
          firstName: targetBody.lastName,
          lastName: targetBody.firstName
        })
      );
    }

    if (targetBody.firstName && targetBody.middleName) {
      query.$or.push(
        buildRuleFilterPart({
          firstName: targetBody.firstName,
          middleName: targetBody.middleName
        }),
        // reverse checks
        buildRuleFilterPart({
          firstName: targetBody.middleName,
          middleName: targetBody.firstName
        })
      );
    }

    if (targetBody.middleName && targetBody.lastName) {
      query.$or.push(
        buildRuleFilterPart({
          middleName: targetBody.middleName,
          lastName: targetBody.lastName
        }),
        // reverse checks
        buildRuleFilterPart({
          middleName: targetBody.lastName,
          lastName: targetBody.middleName
        })
      );
    }

    // we check this only if phone number exists in the target
    if (targetBody.phoneNumber && targetBody.gender) {
      query.$or.push(buildRuleFilterPart({
        phoneNumber: targetBody.phoneNumber,
        gender: targetBody.gender
      }));
    }

    // check against each document in the target body
    if (targetBody.documents) {
      targetBody.documents.forEach((doc) => {
        // we only search the documents that have both target properties with values
        if (doc.type && doc.number) {
          query.$or.push({
            documents: {
              $elemMatch: {
                $and: [
                  {
                    $and: [
                      {
                        type: {
                          $ne: null
                        }
                      },
                      {
                        type: doc.type
                      }
                    ]
                  },
                  {
                    $and: [
                      {
                        number: {
                          $ne: null
                        }
                      },
                      {
                        number: doc.number
                      }
                    ]
                  }
                ]
              }
            }
          });
        }
      });
    }

    // exclude target instance from the checks
    if (targetBody.id) {
      query._id = {$ne: targetBody.id};
    }

    // remove empty queries
    if (!query.$or.length) {
      delete query.$or;
    }

    return app.models.person.rawFind(query, {skip: filter.skip, limit: filter.limit});
  };
};
