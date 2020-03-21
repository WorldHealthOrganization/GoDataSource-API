'use strict';

// requires
const app = require('../server');
const personDuplicate = require('../../components/workerRunner').personDuplicate;
const helpers = require('../../components/helpers');
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
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'dateRanges': 'LNG_CASE_FIELD_LABEL_DATE_RANGES',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'safeBurial': 'LNG_CASE_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CASE_FIELD_LABEL_DATE_OF_BURIAL'
  });

  Person.referenceDataFields = [
    'gender',
    'classification',
    'riskLevel',
    'outcomeId',
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
    'dateOfInfection',
    'dateOfOnset',
    'riskLevel',
    'riskReason',
    'outcomeId',
    'dateOfOutcome',
    'dateOfBurial',
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

  Person.dossierDateFields = [
    'dob',
    'dateRanges[].startDate',
    'dateRanges[].endDate',
    'addresses[].date',
    'dateBecomeCase',
    'dateOfReporting',
    'dateOfInfection',
    'dateOfOnset',
    'dateOfOutcome',
    'dateOfBurial',
    'vaccinesReceived[].date',
    // general relationship/person dates
    'relationships[].contactDate',
    'relationships[].people[].vaccinesReceived[].date',
    // event dates
    'relationships[].people[].date',
    'relationships[].people[].address.date',
    // case/contact specific dates
    'relationships[].people[].dob',
    'relationships[].people[].dateRanges[].startDate',
    'relationships[].people[].dateRanges[].endDate',
    'relationships[].people[].addresses[].date',
    'relationships[].people[].dateOfReporting',
    'relationships[].people[].dateOfReporting',
    'relationships[].people[].dateOfInfection',
    'relationships[].people[].dateOfOnset',
    'relationships[].people[].dateOfOutcome',
    'relationships[].people[].dateOfBurial',
    // lab result dates
    'labResults[].dateSampleTaken',
    'labResults[].dateSampleDelivered',
    'labResults[].dateTesting',
    'labResults[].dateOfResult',
    // follow up dates
    'followUps[].date',
    'followUps[].address.date'
  ];

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
   * Remove empty addresses and return a filtered array of addresses if an array is provided,
   * otherwise return the provided addresses value ( null | undefined | ... )
   * @param person
   * @returns {Array | any}
   */
  Person.sanitizeAddresses = function (person) {
    if (person.toJSON) {
      person = person.toJSON();
    }

    // filter out empty addresses
    if (person.addresses) {
      return _.filter(person.addresses, (address) => {
        return !!_.find(address, (propertyValue) => {
          return typeof propertyValue === 'string' ?
            !!propertyValue.trim() :
            !!propertyValue;
        });
      });
    }

    // no addresses under this person
    return person.addresses;
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
   * Normalize GeoLocation Coordinates (make sure they are numbers)
   * @param context
   */
  function normalizeGeolocationCoordinates(context) {
    // define person instance
    let personInstance;
    // if this is a new record
    if (context.isNewInstance) {
      // get instance data from the instance
      personInstance = context.instance;
    } else {
      // existing instance, we're interested only in what is modified
      personInstance = context.data;
    }

    /**
     * Normalize address coordinates
     * @param address
     */
    function normalizeAddressCoordinates(address) {
      // check if both coordinates are available and not numbers; make sure they are numbers
      if (address.geoLocation &&
        address.geoLocation.lat &&
        address.geoLocation.lng &&
        (
          isNaN(address.geoLocation.lat) ||
          isNaN(address.geoLocation.lng)
        )
      ) {
        address.geoLocation.lat = parseFloat(address.geoLocation.lat);
        address.geoLocation.lng = parseFloat(address.geoLocation.lng);

        // if sync action set flag for sync "before save" changes
        if (context.options && context.options._sync) {
          context.options._syncActionBeforeSaveChanges = true;
        }
      }
    }

    // if the record has a list of addresses
    if (Array.isArray(personInstance.addresses) && personInstance.addresses.length) {
      // normalize coordinates for each address
      personInstance.addresses.forEach(function (address) {
        normalizeAddressCoordinates(address);
      });
    }
    // if the record has only one address (record is event)
    if (personInstance.address) {
      // normalize the address
      normalizeAddressCoordinates(personInstance.address);
    }
  }

  /**
   * Before save hooks
   */
  Person.observe('before save', function (context, next) {
    // normalize geo-points
    normalizeGeolocationCoordinates(context);

    // get context data
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);

    // trigger relationships updates on case classification change to/from discarded
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

    // validate addresses
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

    // make sure we update data in order so we don't break anything
    Promise
      .resolve()
      .then(() => {
        // if there are no dates then there is no point in continuing
        const modelNewData = data.source.all;
        if (
          !modelNewData.dateRanges ||
          !_.isArray(modelNewData.dateRanges) ||
          modelNewData.dateRanges.length < 1
        ) {
          return;
        }

        // we need to make sure dataRange.center names are migrated properly
        const centerNames = {};
        const centreNameReferenceDataCategory = 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME';
        modelNewData.dateRanges.forEach((dateRange) => {
          // do we have a center name, if not there is no point in continuing
          // or if we have already a reference data item inside, then we don't need to update this date range
          const trimmedCentreName = (dateRange.centerName || '').trim();
          if (
            !trimmedCentreName ||
            trimmedCentreName.startsWith('LNG_REFERENCE_DATA')
          ) {
            return;
          }

          // determine center name id accordingly to migrateCaseCentreName.js script logic
          const refDataItemId = `${centreNameReferenceDataCategory}_${_.snakeCase(trimmedCentreName).toUpperCase()}`;
          if (!centerNames[refDataItemId]) {
            centerNames[refDataItemId] = {
              id: refDataItemId,
              value: trimmedCentreName
            };
          }

          // add date range to items to update
          dateRange.centerName = refDataItemId;
        });

        // do we need to update date ranges, if not, there no point in continuing
        if (_.isEmpty(centerNames)) {
          return;
        }

        // we need to update center names
        const dataToUpdate = data.target;
        dataToUpdate.dateRanges = modelNewData.dateRanges;

        // retrieve ref data items to see if we need to create anything
        return app.models.referenceData
          .rawFind({
            _id: {
              $in: Object.keys(centerNames)
            }
          }, {projection: { _id: 1 }})
          .then((refItems) => {
            // remove items that exist already
            (refItems || []).forEach((refItem) => {
              delete centerNames[refItem.id];
            });

            // if we don't have to create reference data item, than God finished with this promise
            if (_.isEmpty(centerNames)) {
              return;
            }

            // prepare reference data items that we need to create
            const now = new Date();
            const authorInfo = {
              createdBy: 'system',
              updatedBy: 'system',
              createdAt: now,
              updatedAt: now
            };
            const referenceDataEntriesJobs = [];
            _.each(centerNames, (centerData) => {
              // create ref item
              referenceDataEntriesJobs.push(
                app.models.referenceData
                  .create(
                    Object.assign(
                      {
                        _id: centerData.id,
                        categoryId: centreNameReferenceDataCategory,
                        value: centerData.value,
                        description: '',
                        readOnly: false,
                        active: true,
                        deleted: false
                      },
                      authorInfo
                    ), {
                      _init: true
                    }
                  )
              );

              // create language tokens
              // Handled by ref data item create hooks
            });

            // create reference data items
            return Promise.all(referenceDataEntriesJobs).then(() => undefined);
          });
      })
      .then(() => {
        // special sync logic as no validation of visualId is required on sync
        if (context.options && context.options._sync) {
          // we need to generate the visualId when the generatePersonVisualId flag is sent and person visual ID is empty
          if (!context.options.generatePersonVisualId) {
            return next();
          }

          // if visual ID is sent or instance already has it no need to do anything
          if (data.target.visualId || data.source.all.visualId) {
            return next();
          }

          // generatePersonVisualId is true and visual ID was not sent; try to generate the visual ID
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

              // get mask property
              let maskProperty = data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ? 'caseIdMask' : 'contactIdMask';

              // resolve visual ID; send the mask as the visualId to not break logic
              return app.models.outbreak.helpers
                .getAvailableVisualId(
                  outbreak,
                  maskProperty,
                  app.models.person.sanitizeVisualId(outbreak[maskProperty])
                );
            })
            .then(function (resolvedVisualId) {
              data.target.visualId = resolvedVisualId;

              // set flag for sync "before save" changes
              context.options._syncActionBeforeSaveChanges = true;

              next();
            })
            .catch(function (err) {
              // mask couldn't be generated; log error and continue saving the user
              app.logger.debug(`Failed generating visualId for person '${data.target.id}'. Error: ${err}`);
              next();
            });

          // stop logic for sync
          return;
        }

        // sync action doesn't need validation and it doesn't reach here
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
                .resolvePersonVisualIdTemplate(outbreak, data.target.visualId, data.source.existingRaw.type, context.isNewInstance ? null : data.source.existing.id);
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
      })
      .catch(next);
  });

  /**
   * Before delete hooks
   * - archive visual ID before soft-deleting record so we can add a new case with the same case ID
   */
  Person.observe('before delete', function (context, next) {
    // in case we have visual ID we need to remove if before soft deleting this record
    if (context.currentInstance.visualId) {
      // archive visual ID
      context.data.documents = context.currentInstance.documents || [];
      context.data.documents.push({
        type: 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE_ARCHIVED_ID',
        number: context.currentInstance.visualId
      });

      // remove visual ID
      context.data.visualId = null;
    }

    // continue
    next();
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
   * @returns {Promise} Returns => { peopleDistribution: [...], locationCorelationMap: { ... } }. People without an address are grouped under a dummy location with name '-'
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
            let locationHierarchy = app.models.location.buildHierarchicalLocationsList(allLocations, null, outbreak.reportingGeographicalLevelId);
            let locationCorelationMap = {};

            // Initiate peopleDistribution as an object so we can add locations/people to it easier
            // we need an empty location for people without addresses
            let peopleDistribution = {
              [app.models.location.noLocation.id]: {
                location: app.models.location.noLocation,
                people: []
              }
            };

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
                  if (personCurrentLocation) {
                    if (locationCorelationMap[personCurrentLocation]) {
                      peopleDistribution[locationCorelationMap[personCurrentLocation]].people.push(person);
                    } else {
                      // geographicalLevelId not matched
                      // NOT HANDLED
                    }
                  } else {
                    peopleDistribution[app.models.location.noLocation.id].people.push(person);
                  }
                });

                // After the peopleDistribution object is fully populate it, use only it's values from now on.
                // The keys were used only to easily distribute the locations/people
                resolve({
                  peopleDistribution: Object
                    .values(peopleDistribution)
                    .filter(entry => entry.people.length),
                  locationCorelationMap: locationCorelationMap
                });
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
    return Person.getCurrentAddress(this);
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
    filter = filter || {};
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

    // find duplicates only if there is something to look for
    if (query.$or) {
      return app.models.person.rawFind(query, {skip: filter.skip, limit: filter.limit});
    } else {
      // otherwise return empty list
      return Promise.resolve([]);
    }
  };

  /**
   * retrieve available people for a specific case / contact / event
   * @param outbreakId
   * @param personId
   * @param filter
   * @returns {Promise<any>}
   */
  Person.getAvailablePeople = function (
    outbreakId,
    personId,
    filter
  ) {
    filter = filter || {};
    // attach our conditions
    filter.where = {
      and: [
        {
          outbreakId: outbreakId,
          id: {
            neq: personId
          },
          classification: {
            nin: app.models.case.discardedCaseClassifications
          }
        },
        filter.where ? filter.where : {}
      ]
    };

    // retrieve data
    return Person
      .find(filter)
      .then((records) => {
        return Person.determineIfRelationshipsExist(
          outbreakId,
          personId,
          records
        );
      });
  };

  /**
   * retrieve available people for a specific case / contact / event
   * @param outbreakId
   * @param personId
   * @param where
   * @returns {Promise<any>}
   */
  Person.getAvailablePeopleCount = function (
    outbreakId,
    personId,
    where
  ) {
    // attach our conditions
    where = {
      and: [
        {
          outbreakId: outbreakId
        }, {
          id: {
            neq: personId
          }
        },
        where ? where : {}
      ]
    };

    // retrieve data
    return Person.count(where);
  };

  /**
   * Determine which relationships could be a duplicate ( add property to each record from the relatedPeopleDara array )
   * @param outbreakId
   * @param personId
   * @param relatedPeopleData
   * @returns {Promise<any>}
   */
  Person.determineIfRelationshipsExist = function (
    outbreakId,
    personId,
    relatedPeopleData
  ) {
    return new Promise((resolve, reject) => {
      // determine people ids which we need to check if they are duplicates
      const peopleIds = (relatedPeopleData || []).map((r) => r.id);

      // retrieve all relationships of interest
      app.models.relationship
        .rawFind({
          or: [{
            'persons.0.id': personId,
            'persons.1.id': {
              inq: peopleIds
            }
          }, {
            'persons.1.id': personId,
            'persons.0.id': {
              inq: peopleIds
            }
          }]
        }, {
          projection: {
            _id: 1,
            persons: 1
          }
        })
        .then((relationshipsData) => {
          // match relationship data to people
          (relationshipsData || []).forEach((relData) => {
            // first person is the main person ?
            let indexOfRelatedPerson = 0;
            if (relData.persons[0].id === personId) {
              indexOfRelatedPerson = 1;
            }

            // add person match
            const relatedRecord = _.find(relatedPeopleData, (r) => r.id === relData.persons[indexOfRelatedPerson].id);
            if (relatedRecord) {
              // initialize matches ?
              if (!relatedRecord.matchedDuplicateRelationships) {
                relatedRecord.matchedDuplicateRelationships = [];
              }

              // add our match
              relatedRecord.matchedDuplicateRelationships.push({
                relationshipId: relData.id,
                relatedPerson: relData.persons[indexOfRelatedPerson]
              });
            }
          });

          // finished
          resolve(relatedPeopleData);
        })
        .catch(reject);
    });
  };

  /**
   * Get bar transmission chains data
   * @param outbreakId
   * @param filter
   * @param callback
   */
  Person.getBarsTransmissionChainsData = function (outbreakId, filter, callback) {
    // convert filter to mongodb filter structure
    filter = filter || {};
    filter.where = filter.where || {};

    // parse filter
    const parsedFilter = app.utils.remote.convertLoopbackFilterToMongo(
      {
        $and: [
          // make sure we're only retrieve cases from the current outbreak
          {
            outbreakId: outbreakId
          },

          // retrieve only non-deleted records
          {
            $or: [{
              deleted: false
            }, {
              deleted: {
                $eq: null
              }
            }]
          },

          // retrieve cases & events
          {
            type: {
              $in: [
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
              ]
            }
          },

          // remove discarded cases
          // shouldn't affect events since there we don't have classification and we use a nin condition
          {
            classification: {
              nin: app.models.case.discardedCaseClassifications
            }
          },

          // conditions coming from request
          filter.where
        ]
      });

    // query aggregation
    const aggregatePipeline = [
      // match conditions
      {
        $match: parsedFilter
      },

      // retrieve lab results for cases
      {
        $lookup: {
          from: 'labResult',
          localField: '_id',
          foreignField: 'personId',
          as: 'labResults'
        }
      },

      // retrieve relationships where case / event is source
      {
        $lookup: {
          from: 'relationship',
          localField: '_id',
          foreignField: 'persons.id',
          as: 'relationships'
        }
      },

      // filter & retrieve only needed data
      {
        $project: {
          // case / event fields
          id: '$_id',
          visualId: 1,
          type: 1,
          firstName: {
            $cond: {
              if: {$eq: ['$type', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']},
              then: '$name',
              else: '$firstName'
            }
          },
          lastName: 1,
          date: {
            $cond: {
              if: {$eq: ['$type', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']},
              then: '$date',
              else: '$dateOfOnset'
            }
          },
          outcomeId: 1,
          dateOfOutcome: 1,
          safeBurial: 1,
          dateOfBurial: 1,
          addresses: {
            $cond: {
              if: {$eq: ['$type', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']},
              then: ['$address'],
              else: '$addresses'
            }
          },
          dateRanges: {
            $map: {
              input: '$dateRanges',
              as: 'dateRange',
              in: {
                typeId: '$$dateRange.typeId',
                locationId: '$$dateRange.locationId',
                startDate: '$$dateRange.startDate',
                endDate: '$$dateRange.endDate',
                centerName: '$$dateRange.centerName'
              }
            }
          },

          // lab results fields
          labResults: {
            $map: {
              input: {
                $filter: {
                  input: '$labResults',
                  as: 'lab',
                  cond: {
                    $or: [{
                      $eq: ['$$lab.deleted', false]
                    }, {
                      $eq: ['$$lab.deleted', null]
                    }]
                  }
                }
              },
              as: 'lab',
              in: {
                dateOfResult: '$$lab.dateOfResult',
                dateSampleTaken: '$$lab.dateSampleTaken',
                testType: '$$lab.testType',
                result: '$$lab.result'
              }
            }
          },

          // relationship fields
          relationships: {
            $map: {
              input: {
                $filter: {
                  input: '$relationships',
                  as: 'rel',
                  cond: {
                    $or: [{
                      $eq: ['$$rel.deleted', false]
                    }, {
                      $eq: ['$$rel.deleted', null]
                    }]
                  }
                }
              },
              as: 'rel',
              in: {
                persons: '$$rel.persons'
              }
            }
          }
        }
      }
    ];

    // run request to db
    const cursor = app.dataSources.mongoDb.connector
      .collection('person')
      .aggregate(aggregatePipeline);

    // get the records from the cursor
    cursor
      .toArray()
      .then((records) => {
        // sort by date method
        const compareDates = (date1, date2) => {
          // compare missing dates & dates
          if (!date1 && !date2) {
            return 0;
          } else if (!date1) {
            return 1;
          } else if (!date2) {
            return -1;
          } else {
            // compare dates
            return helpers.getDate(date1).diff(helpers.getDate(date2));
          }
        };

        // determine center name used for determining same centers
        const centerNameToCompareValue = (centerName) => {
          return centerName ?
            centerName.trim().toLowerCase().replace(/[^a-z0-9\s]/gi, '').replace(/\s\s+/g, ' ') :
            centerName;
        };

        // sanitize records & determine other things :)
        const response = {
          personsMap: {},
          personsOrder: [],
          relationships: {},
          minGraphDate: null,
          maxGraphDate: null
        };
        (records || []).forEach((recordData) => {
          // sort addresses
          if (recordData.addresses) {
            recordData.addresses.sort((address1, address2) => {
              // compare missing dates & dates
              return compareDates(address1.date, address2.date);
            });
          }

          // transform relationships
          if (recordData.relationships) {
            // go through relationships and determine which can be added to our list
            (recordData.relationships || []).forEach((rel) => {
              // add to the list of relationships if both records are cases /  events & our case / event is the source
              if (
                rel.persons.length > 1 && (
                  rel.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ||
                  rel.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                ) && (
                  rel.persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ||
                  rel.persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                ) && (
                  (rel.persons[0].source && rel.persons[0].id === recordData.id) ||
                  (rel.persons[1].source && rel.persons[1].id === recordData.id)
                )
              ) {
                // determine if we need to initialize the list of target cases / events for our source case / event
                if (!response.relationships[recordData.id]) {
                  response.relationships[recordData.id] = [];
                }

                // add to the list
                response.relationships[recordData.id].push(rel.persons[0].id === recordData.id ? rel.persons[1].id : rel.persons[0].id);
              }
            });

            // finished - case / event relationship data not needed anymore
            delete recordData.relationships;
          }

          // determine lastGraphDate
          // - should be the most recent date from case.dateOfOnset / case.dateRanges.endDate / case.labResults.dateSampleTaken / event.date
          recordData.lastGraphDate = helpers.getDate(recordData.date);

          // determine firstGraphDate
          // - should be the oldest date from case.dateOfOnset / case.dateRanges.endDate / case.labResults.dateSampleTaken / event.date
          recordData.firstGraphDate = helpers.getDate(recordData.date);

          // determine lastGraphDate starting with lab results
          // applies only for cases, since events don't have lab results
          if (recordData.labResults) {
            const labResults = recordData.labResults || [];
            recordData.labResults = [];
            labResults.forEach((lab) => {
              // ignore lab results without result date or sample taken
              if (
                !lab.dateOfResult &&
                !lab.dateSampleTaken
              ) {
                return;
              }

              // actions only if we have date of result
              if (lab.dateOfResult) {
                // determine lastGraphDate
                const dateOfResult = helpers.getDate(lab.dateOfResult);
                recordData.lastGraphDate = !recordData.lastGraphDate ?
                  dateOfResult : (
                    dateOfResult.isAfter(recordData.lastGraphDate) ?
                      dateOfResult :
                      recordData.lastGraphDate
                  );

                // determine min graph date
                recordData.firstGraphDate = !recordData.firstGraphDate ?
                  dateOfResult : (
                    dateOfResult.isBefore(recordData.firstGraphDate) ?
                      dateOfResult :
                      recordData.firstGraphDate
                  );

                // fallback to dateSampleTaken
              } else {
                // determine lastGraphDate
                const dateSampleTaken = helpers.getDate(lab.dateSampleTaken);
                recordData.lastGraphDate = !recordData.lastGraphDate ?
                  dateSampleTaken : (
                    dateSampleTaken.isAfter(recordData.lastGraphDate) ?
                      dateSampleTaken :
                      recordData.lastGraphDate
                  );

                // determine min graph date
                recordData.firstGraphDate = !recordData.firstGraphDate ?
                  dateSampleTaken : (
                    dateSampleTaken.isBefore(recordData.firstGraphDate) ?
                      dateSampleTaken :
                      recordData.firstGraphDate
                  );
              }

              // since we have dateSampleTaken, lets add it to the list
              recordData.labResults.push(lab);
            });
          }

          // check if there is a date range more recent
          // applies only for cases, since events don't have lab results
          if (recordData.dateRanges) {
            const dateRanges = recordData.dateRanges || [];
            recordData.dateRanges = [];
            dateRanges.forEach((dateRange) => {
              // ignore date range without at least one of the dates ( start / end )
              if (!dateRange.endDate && !dateRange.startDate) {
                return;
              }

              // make sure we have start date
              dateRange.startDate = dateRange.startDate ? helpers.getDate(dateRange.startDate) : helpers.getDate(recordData.date);

              // if we don't have an end date then we need to set the current date since this is still in progress
              dateRange.endDate = dateRange.endDate ? helpers.getDate(dateRange.endDate) : helpers.getDate();

              // determine min graph date
              if (dateRange.startDate) {
                recordData.firstGraphDate = !recordData.firstGraphDate ?
                  dateRange.startDate : (
                    dateRange.startDate.isBefore(recordData.firstGraphDate) ?
                      dateRange.startDate :
                      recordData.firstGraphDate
                  );
              }

              // determine last graph date
              recordData.lastGraphDate = !recordData.lastGraphDate ?
                dateRange.endDate : (
                  dateRange.endDate.isAfter(recordData.lastGraphDate) ?
                    dateRange.endDate :
                    recordData.lastGraphDate
                );

              // add center name to list
              if (!recordData.centerNames) {
                recordData.centerNames = {};
              }
              const centerName = dateRange.centerName ? dateRange.centerName.trim() : null;
              if (centerName) {
                recordData.centerNames[centerNameToCompareValue(centerName)] = centerName;
              }

              // since we have either start date or end date we can use it for the graph
              recordData.dateRanges.push(dateRange);
            });
          }

          // determine min & max dates taking in consideration dateOfOutcome
          if (recordData.dateOfOutcome) {
            // determine dateOfOutcome
            const dateOfOutcome = helpers.getDate(recordData.dateOfOutcome);

            // determine min graph date
            recordData.firstGraphDate = !recordData.firstGraphDate ?
              dateOfOutcome : (
                dateOfOutcome.isBefore(recordData.firstGraphDate) ?
                  dateOfOutcome :
                  recordData.firstGraphDate
              );

            // determine last graph date
            recordData.lastGraphDate = !recordData.lastGraphDate ?
              dateOfOutcome : (
                dateOfOutcome.isAfter(recordData.lastGraphDate) ?
                  dateOfOutcome :
                  recordData.lastGraphDate
              );
          }

          // determine min & max dates taking in consideration dateOfBurial
          if (recordData.dateOfBurial) {
            // determine dateOfBurial
            const dateOfBurial = helpers.getDate(recordData.dateOfBurial);

            // determine min graph date
            recordData.firstGraphDate = !recordData.firstGraphDate ?
              dateOfBurial : (
                dateOfBurial.isBefore(recordData.firstGraphDate) ?
                  dateOfBurial :
                  recordData.firstGraphDate
              );

            // determine last graph date
            recordData.lastGraphDate = !recordData.lastGraphDate ?
              dateOfBurial : (
                dateOfBurial.isAfter(recordData.lastGraphDate) ?
                  dateOfBurial :
                  recordData.lastGraphDate
              );
          }

          // determine oldest case onset date / event date
          response.minGraphDate = !response.minGraphDate ?
            recordData.firstGraphDate : (
              recordData.firstGraphDate.isBefore(response.minGraphDate) ?
                recordData.firstGraphDate :
                response.minGraphDate
            );

          // determine the most recent case graph date
          response.maxGraphDate = !response.maxGraphDate ?
            recordData.lastGraphDate : (
              recordData.lastGraphDate.isAfter(response.maxGraphDate) ?
                recordData.lastGraphDate :
                response.maxGraphDate
            );

          // convert center names object to array
          // & sort them by name
          recordData.centerNames = recordData.centerNames ?
            Object.values(recordData.centerNames).sort() :
            [];
          recordData.centerNamesSortBy = recordData.centerNames.map((item) => centerNameToCompareValue(item)).join();

          // add response case / event
          delete recordData._id;
          response.personsMap[recordData.id] = recordData;
        });

        //sort cases & events
        response.personsOrder = Object
          .values(response.personsMap)
          .sort((person1, person2) => {
            // compare center names
            // items with no center names should be put at the  end of the list
            const centerNameCompareResult = !person1.centerNamesSortBy && !person2.centerNamesSortBy ? 0 : (
              !person1.centerNamesSortBy ? 1 : (
                !person2.centerNamesSortBy ? -1 :
                  person1.centerNamesSortBy.localeCompare(person2.centerNamesSortBy)
              )
            );
            if (centerNameCompareResult !== 0) {
              return centerNameCompareResult;
            }

            // compare missing dates & dates
            return compareDates(person1.date, person2.date);
          })
          .map((personData) => personData.id);

        // remove unused properties
        _.each(response.personsMap, (item) => {
          // remove properties
          delete item.centerNamesSortBy;
        });

        // return results
        return callback(
          null,
          response
        );
      })
      .catch(callback);
  };

  /**
   * Replace system visual ID system values
   * @param visualId
   */
  Person.sanitizeVisualId = (visualId) => {
    return !visualId ? visualId : visualId
      .replace(/YYYY/g, moment().format('YYYY'))
      .replace(/\*/g, '');
  };

  /**
   * Count contacts/exposures for a list of records
   * @param outbreakId
   * @param peopleIds
   */
  Person.getPeopleContactsAndExposures = function (outbreakId, peopleIds) {
    const peopleMap = {};
    for (let id of peopleIds) {
      peopleMap[id] = {
        numberOfContacts: 0,
        numberOfExposures: 0
      };
    }

    return app.models.relationship
      .find({
        where: {
          outbreakId: outbreakId,
          'persons.id': {
            inq: peopleIds
          }
        }
      })
      .then((relations) => {
        for (let relation of relations) {
          const relationParticipants = relation.persons;
          for (let participant of relationParticipants) {
            if (peopleMap[participant.id]) {
              if (participant.source) {
                peopleMap[participant.id].numberOfContacts++;
              } else {
                peopleMap[participant.id].numberOfExposures++;
              }
            }
          }
        }
      })
      .then(() => peopleMap);
  };
};
