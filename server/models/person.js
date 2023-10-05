'use strict';

// requires
const app = require('../server');
const personDuplicate = require('../../components/workerRunner').personDuplicate;
const helpers = require('../../components/helpers');
const _ = require('lodash');
const personConstants = require('../../components/baseModelOptions/person').constants;
const addressConstants = require('../../components/baseModelOptions/address').constants;
const localizationHelper = require('../../components/localizationHelper');

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

  Person.fieldLabelsMap = personConstants.fieldLabelsMap;

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
    'wasCase',
    'dateBecomeCase',
    'wasContact',
    'dateBecomeContact',
    'wasContactOfContact',
    'dateBecomeContactOfContact',
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
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'event',
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT': 'contactOfContact'
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
  Person.sanitizeAddresses = app.utils.helpers.sanitizePersonAddresses;

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
   * Set usualPlaceOfResidenceLocationId when addresses are updated
   * @param context
   */
  function setUsualPlaceOfResidenceLocationId(context) {
    // define person instance
    let personInstance;
    // if this is a new record
    if (context.isNewInstance) {
      // get instance data from the instance
      personInstance = context.instance;

      // set usualPlaceOfResidenceLocationId as null by default
      personInstance.usualPlaceOfResidenceLocationId = null;
    } else {
      // existing instance, we're interested only in what is modified
      personInstance = context.data;
    }

    // check if address/addresses field was touched
    if (personInstance.address === undefined && personInstance.addresses === undefined) {
      return;
    }

    // person address was touched; get new usualPlaceOfResidenceLocationId
    // event
    let modelName = context.Model.modelName;
    if (
      modelName === app.models.event.modelName &&
      personInstance.address !== undefined
    ) {
      // event address was changed
      if (
        // address was removed entirely
        personInstance.address === null ||
        // locationId was removed or not set
        !personInstance.address.locationId
      ) {
        // set usualPlaceOfResidenceLocationId
        personInstance.usualPlaceOfResidenceLocationId = null;
        return;
      }
      // address was updated, is usual place of residence and locationId was set
      else {
        // set usualPlaceOfResidenceLocationId
        personInstance.usualPlaceOfResidenceLocationId = personInstance.address.locationId;
        return;
      }
    }

    // case/contact/contact of contact
    if (personInstance.addresses === null) {
      // addresses were removed
      // set usualPlaceOfResidenceLocationId
      personInstance.usualPlaceOfResidenceLocationId = null;
      return;
    }

    // loop through addresses and get usualPlaceOfResidenceLocationId
    // get usual place of residence address
    let usualPlaceOfResidenceAddress = personInstance.addresses.find(address => address.typeId === addressConstants.usualPlaceOfResidenceType);

    // get locationId from usual place of residence address and set usualPlaceOfResidenceLocationId
    personInstance.usualPlaceOfResidenceLocationId = usualPlaceOfResidenceAddress && usualPlaceOfResidenceAddress.locationId ?
      usualPlaceOfResidenceAddress.locationId :
      null;
  }

  /**
   * Before save hooks
   */
  Person.observe('before save', function (context, next) {
    // normalize geo-points
    normalizeGeolocationCoordinates(context);

    // set usual place of residence locationId
    setUsualPlaceOfResidenceLocationId(context);

    // get context data
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);

    // trigger relationships updates on case classification change to/from discarded
    if (
      (
        !context.isNewInstance &&
        data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
        && data.source.updated
        && data.source.updated.classification
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

    // set duplicate easy find index keys
    if (
      data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ||
      data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' ||
      data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
    ) {
      // first, last, middle names
      helpers.attachDuplicateKeys(
        data.target,
        data.source.all,
        'name',
        [
          ['firstName', 'lastName'],
          ['firstName', 'middleName'],
          ['lastName', 'middleName']
        ]
      );

      // attach documents
      helpers.attachDuplicateKeys(
        data.target,
        data.source.all,
        'document',
        [
          ['type', 'number']
        ],
        'documents'
      );

      // if duplicate values are the same - delete from update
      if (_.isEqual(
        data.target.duplicateKeys,
        data.source.all.duplicateKeys
      )) {
        delete data.target.duplicateKeys;
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
          }, {projection: {_id: 1}})
          .then((refItems) => {
            // remove items that exist already
            (refItems || []).forEach((refItem) => {
              delete centerNames[refItem.id];
            });

            // if we don't have to create reference data item, than God finished with this promise
            if (_.isEmpty(centerNames)) {
              return;
            }

            // if we're in sync mode then we need to retrieve languages too
            return Promise
              .resolve()
              .then(() => {
                if (context.options && context.options._sync) {
                  // get the languages list and create a token entry for each language
                  return app.models.language.rawFind({}, {projection: {id: 1}});
                }
              })
              .then((languages) => {
                // prepare reference data items that we need to create
                const now = localizationHelper.now().toDate();
                const authorInfo = {
                  createdBy: 'system',
                  updatedBy: 'system',
                  createdAt: now,
                  updatedAt: now,
                  dbUpdatedAt: now
                };
                const jobs = [];
                _.each(centerNames, (centerData) => {
                  // create ref item
                  jobs.push(
                    app.models.referenceData.create(
                      Object.assign(
                        {
                          id: centerData.id,
                          categoryId: centreNameReferenceDataCategory,
                          value: context.options && context.options._sync ?
                            centerData.id : centerData.value,
                          description: '',
                          readOnly: false,
                          active: true,
                          deleted: false
                        },
                        authorInfo
                      ),
                      context.options
                    )
                  );

                  // create language tokens
                  // Handled by ref data item create hooks if not _sync
                  if (context.options && context.options._sync) {
                    (languages || []).forEach((language) => {
                      // create language token
                      jobs.push(
                        app.models.languageToken.create(
                          Object.assign(
                            {
                              id: app.models.languageToken.generateID(centerData.id, language.id),
                              token: centerData.id,
                              languageId: language.id,
                              translation: centerData.value
                            },
                            authorInfo
                          ),
                          context.options
                        )
                      );

                      // create language token description
                      jobs.push(
                        app.models.languageToken.create(
                          Object.assign(
                            {
                              id: app.models.languageToken.generateID(`${centerData.id}_DESCRIPTION`, language.id),
                              token: `${centerData.id}_DESCRIPTION`,
                              languageId: language.id,
                              translation: ''
                            },
                            authorInfo
                          ),
                          context.options
                        )
                      );
                    });
                  }
                });

                // create reference data items
                return Promise.all(jobs).then(() => undefined);
              });
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
              let maskProperty;
              switch (data.source.existingRaw.type) {
                case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT':
                  maskProperty = 'eventIdMask';

                  break;
                case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE':
                  maskProperty = 'caseIdMask';

                  break;
                case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT':
                  maskProperty = 'contactIdMask';

                  break;
                case 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT':
                  maskProperty = 'contactOfContactIdMask';

                  break;
              }

              if (!maskProperty) {
                throw app.utils.apiError.getError('MASK_NOT_FOUND', {
                  model: app.models.outbreak.modelName,
                  id: data.source.existing.outbreakId,
                  type: data.source.existingRaw.type
                });
              }

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
      // reset flag
      delete ctx.options.triggerRelationshipUpdates;
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
   * @param options
   * @return {Promise<any>}
   */
  Person.findOrCountPossibleDuplicates = function (filter, countOnly, options) {
    // define default filter
    filter = filter || {};

    // promisify the response
    return new Promise(function (resolve, reject) {
      let where = filter.where || {};
      // query non deleted records only
      where = {
        $and: [
          {
            deleted: false
          },
          where || {}
        ]
      };

      // add geographical restrictions if needed
      Person.addGeographicalRestrictions(options.remotingContext, where)
        .then(updatedFilter => {
          // update where if needed
          updatedFilter && (where = updatedFilter);
          where = app.utils.remote.convertLoopbackFilterToMongo(where);

          // use connector directly to bring big number of (raw) results
          // #TODO:
          // - move logic to worker
          // - get data in batches
          app.dataSources.mongoDb.connector
            .collection('person')
            .find(
              where, {
                projection: {
                  _id: 1,
                  type: 1,
                  visualId: 1,
                  name: 1,
                  firstName: 1,
                  lastName: 1,
                  middleName: 1,
                  documents: 1,
                  notDuplicatesIds: 1,
                  age: 1,
                  addresses: 1,
                  address: 1
                }
              }
            )
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
        })
        .catch(reject);
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
          'persons.type': {
            inq: personRecord.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT' ?
              ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'] :
              ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
          },
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
          lastContactDate = localizationHelper.toMoment(lastContactDate).toDate();
        }
        // make sure dateOfLastContact is a Date
        if (personRecord.dateOfLastContact && !(personRecord.dateOfLastContact instanceof Date)) {
          personRecord.dateOfLastContact = localizationHelper.toMoment(personRecord.dateOfLastContact).toDate();
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
   * @param options Options from request
   * @returns {Promise} Returns => { peopleDistribution: [...], locationCorelationMap: { ... } }. People without an address are grouped under a dummy location with name '-'
   */
  Person.getPeoplePerLocation = function (personModel, filter, outbreak, options) {
    // get user allowed locations IDs
    return app.models.user.helpers
      .getUserAllowedLocationsIds(options.remotingContext)
      .then(userAllowedLocationsIds => {
        let outbreakLocationIds;
        // update filter only if outbreak has locations ids defined (otherwise leave it as undefined)
        if (Array.isArray(outbreak.locationIds) && outbreak.locationIds.length) {
          // get outbreak location Ids
          outbreakLocationIds = outbreak.locationIds;
        }

        // check for locations restrictions; either from outbreak or user or both
        let getAllowedLocationsIdsPromise;

        if (!outbreakLocationIds && !userAllowedLocationsIds) {
          // neither outbreak nor user have location restrictions
          getAllowedLocationsIdsPromise = Promise.resolve();
        } else if (outbreakLocationIds && !userAllowedLocationsIds) {
          // only outbreak has restrictions
          getAllowedLocationsIdsPromise = Promise.resolve(outbreakLocationIds);
        } else if (!outbreakLocationIds && userAllowedLocationsIds) {
          // only user has restrictions
          getAllowedLocationsIdsPromise = Promise.resolve(userAllowedLocationsIds);
        } else {
          // both have restrictions; use intersection
          // first get outbreak locations including sub-locations
          getAllowedLocationsIdsPromise = app.models.location.cache
            .getSublocationsIds(outbreakLocationIds)
            .then(allOutbreakLocationIds => {
              // get intersection
              return Promise.resolve(allOutbreakLocationIds.filter(locationId => userAllowedLocationsIds.indexOf(locationId) !== -1));
            });
        }

        return getAllowedLocationsIdsPromise;
      })
      .then(allowedLocationsIds => {
        return new Promise((resolve, reject) => {
          // Avoid making secondary request to DB by using a collection of locations instead of an array of locationIds
          app.models.location.getSubLocationsWithDetails(allowedLocationsIds, [], {}, function (error, allLocations) {
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
                      dateInterval = [localizationHelper.getDateStartOfDay(filter.dateOfFollowUp), localizationHelper.getDateEndOfDay(filter.dateOfFollowUp)];
                      delete filter.dateOfFollowUp;
                    } else if (filter.startDate && filter.endDate) {
                      dateInterval = [localizationHelper.getDateStartOfDay(filter.startDate), localizationHelper.getDateEndOfDay(filter.endDate)];
                    }
                  } else {
                    dateInterval = [localizationHelper.getDateStartOfDay(), localizationHelper.getDateEndOfDay()];
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

                // add geographical restriction for person query if needed
                // allowedLocationsIds exist only if user or outbreak restrictions exist
                if (allowedLocationsIds) {
                  _filter.where = {
                    and: [
                      _filter.where,
                      {
                        // get models for the calculated locations and the ones that don't have a usual place of residence location set
                        usualPlaceOfResidenceLocationId: {
                          // using reportingLocationIds as the allowed location were processed above into reporting locations
                          inq: reportingLocationIds.concat([null])
                        }
                      }
                    ]
                  };
                }

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
                        // !!!!!!!!!!!!!!!!!!
                        // Note: for contacts we need to return only the ones with follow-ups in the given dates
                        // Filtering the people map here to avoid refactoring at this point
                        // In this case we should have first retrieve the follow-ups for the given date range and then get only the related people
                        // !!!!!!!!!!!!!!!!!!
                        const result = {};

                        // map follow-ups to people
                        followUps.forEach(function (followUp) {
                          if (!result[followUp.personId]) {
                            result[followUp.personId] = peopleMap[followUp.personId];
                          }
                          result[followUp.personId].followUps.push(followUp);
                        });
                        // return the list of people
                        resolve(Object.values(result));
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
          return localizationHelper.toMoment(a.date).toDate().getTime() - localizationHelper.toMoment(b.date).toDate().getTime();
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
   * @param outbreakId Outbreak id, used to narrow the searches
   * @param type Contact/Case
   * @param targetBody Target body properties (this is used for checking duplicates)
   * @param options Options from request
   */
  Person.findDuplicatesByType = function (outbreakId, type, targetBody, options) {
    // #TODO once we update mongo to min 3.4 we need to change this logic to use a case insensitive index instead of using ci regex which doesn't use indexes...
    // #TODO instead of having these "duplicateKeys"

    // init base query
    let query = {
      outbreakId: outbreakId,
      type: Array.isArray(type) ?
        {
          $in: type
        } :
        type,
      $or: []
    };

    // first - last name condition
    const firstLastName = helpers.getDuplicateKey(targetBody, ['firstName', 'lastName']);
    if (firstLastName) {
      query.$or.push({
        'duplicateKeys.name': firstLastName
      });
    }

    // first - middle name condition
    const firstMiddleName = helpers.getDuplicateKey(targetBody, ['firstName', 'middleName']);
    if (firstMiddleName) {
      query.$or.push({
        'duplicateKeys.name': firstMiddleName
      });
    }

    // last - middle name condition
    const lastMiddleName = helpers.getDuplicateKey(targetBody, ['lastName', 'middleName']);
    if (lastMiddleName) {
      query.$or.push({
        'duplicateKeys.name': lastMiddleName
      });
    }

    // documents conditions
    (targetBody.documents || []).forEach((doc) => {
      const docKey = helpers.getDuplicateKey(
        doc,
        ['type', 'number']
      );
      if (docKey) {
        query.$or.push({
          'duplicateKeys.document': docKey
        });
      }
    });

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
      // determine if we "duplicates" to exclude
      // update filter for geographical restriction if needed
      let promise = Person
        .addGeographicalRestrictions(options.remotingContext, query)
        .then(updatedFilter => {
          // update filter if needed
          updatedFilter && (query = updatedFilter);
        });

      // - we need the latest changes, this is why we can't use targetBody.notDuplicatesIds
      if (targetBody.id) {
        promise = promise
          .then(() => {
            return app.models.person.findById(targetBody.id, {
              fields: [
                'id',
                'notDuplicatesIds'
              ]
            });
          })
          .then((personData) => {
            // do we need to exclude not duplicates ?
            if (
              personData.notDuplicatesIds &&
              personData.notDuplicatesIds.length > 0
            ) {
              // force proper indexes to be used
              query = {
                _id: {
                  $nin: personData.notDuplicatesIds
                },
                $and: [
                  query
                ]
              };
            }
          });
      }

      // finished
      return promise
        .then(() => {
          return app.models.person.rawFind(query);
        });
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
   * @param options Options from request
   * @returns {Promise<any>}
   */
  Person.getAvailablePeople = function (
    outbreakId,
    personId,
    filter,
    options
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

    // make sure we retrieve data needed to determine contacts & exposures
    if (
      filter.fields &&
      filter.fields.length > 0 &&
      filter.fields.indexOf('relationshipsRepresentation') < 0
    ) {
      filter.fields.push('relationshipsRepresentation');
    }

    // update filter for geographical restriction if needed
    return Person
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter if needed
        updatedFilter && (filter.where = updatedFilter);

        // retrieve data
        return Person
          .find(filter);
      })
      .then((records) => {
        // attach possible duplicates
        Person.determineIfRelationshipsExist(
          personId,
          records
        );

        // finished
        return records;
      });
  };

  /**
   * retrieve available people for a specific case / contact / event
   * @param outbreakId
   * @param personId
   * @param filter
   * @param options Options from request
   * @returns {Promise<any>}
   */
  Person.getAvailablePeopleCount = function (
    outbreakId,
    personId,
    filter,
    options
  ) {
    // attach our conditions
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where = {
      and: [
        {
          outbreakId: outbreakId
        }, {
          id: {
            neq: personId
          }
        },
        filter.where ? filter.where : {}
      ]
    };

    // update filter for geographical restriction if needed
    return Person
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter if needed
        updatedFilter && (filter.where = updatedFilter);

        // retrieve data
        return Person.rawCountDocuments(filter);
      });
  };

  /**
   * Determine which relationships could be a duplicate ( add property to each record from the relatedPeopleDara array )
   * @param personId
   * @param relatedPeopleData
   * @returns {Promise<any>}
   */
  Person.determineIfRelationshipsExist = function (
    personId,
    relatedPeopleData
  ) {
    // go through our records and determine possible duplicates
    (relatedPeopleData || []).forEach((record) => {
      // initialize matches ?
      record.matchedDuplicateRelationships = [];

      // go through relationship data and determine contacts / exposures count
      (record.relationshipsRepresentation || []).forEach((relData) => {
        // is our record already in relationships ?
        if (relData.otherParticipantId !== personId) {
          return;
        }

        // add our match
        record.matchedDuplicateRelationships.push({
          relationshipId: relData.id,
          relatedPerson: relData.source ? [
            {
              id: record.id,
              type: record.type,
              source: true
            }, {
              id: relData.otherParticipantId,
              type: relData.otherParticipantType,
              target: true
            }
          ] : [
            {
              id: relData.otherParticipantId,
              type: relData.otherParticipantType,
              source: true
            }, {
              id: record.id,
              type: record.type,
              target: true
            }
          ]
        });
      });
    });
  };

  /**
   * Add geographical restriction in where prop of the filter for logged in user
   * Note: The updated where filter is returned by the Promise; If there filter doesn't need to be updated nothing will be returned
   * @param context Remoting context from which to get logged in user and outbreak
   * @param where Where filter from which to start
   * @returns {Promise<unknown>|Promise<T>|Promise<void>}
   */
  Person.addGeographicalRestrictions = (context, where) => {
    // for sync, logged user model and outbreak model are added in custom properties
    let loggedInUser = context.req.authData.userModelInstance ?
      context.req.authData.userModelInstance :
      context.req.authData.user;
    let outbreak = context.outbreakModelInstance ?
      context.outbreakModelInstance :
      context.instance;

    // apply geographic restrictions ?
    // for mobile sync, the contact createdBy user will be used
    if (
      loggedInUser === undefined ||
      !app.models.user.helpers.applyGeographicRestrictions(loggedInUser, outbreak)
    ) {
      // no need to apply geographic restrictions
      return Promise.resolve();
    }

    // get user allowed locations
    return app.models.user.cache
      .getUserLocationsIds(loggedInUser.id)
      .then(userAllowedLocationsIds => {
        if (!userAllowedLocationsIds.length) {
          // need to get data from all locations
          return Promise.resolve();
        }

        // get query for allowed locations
        const allowedLocationsQuery = {
          // get models for the calculated locations and the ones that don't have a usual place of residence location set
          usualPlaceOfResidenceLocationId: {
            inq: userAllowedLocationsIds.concat([null])
          }
        };

        // update where to only query for allowed locations
        return Promise.resolve(
          where && Object.keys(where).length ?
            {
              and: [
                allowedLocationsQuery,
                where
              ]
            } :
            allowedLocationsQuery
        );
      });
  };

  /**
   * Get bar transmission chains data
   * @param outbreakId
   * @param filter
   * @param options
   * @param callback
   */
  Person.getBarsTransmissionChainsData = function (outbreakId, filter, options, callback) {
    // convert filter to mongodb filter structure
    filter = filter || {};
    filter.where = filter.where || {};

    // update filter for geographical restriction if needed
    Person
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // parse filter
        const parsedFilter = app.utils.remote.convertLoopbackFilterToMongo(
          {
            $and: [
              // make sure we're only retrieve cases from the current outbreak
              {
                outbreakId: outbreakId,
                // retrieve only non-deleted records
                deleted: false,
                // retrieve cases & events
                type: {
                  $in: [
                    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                  ]
                },
                // remove discarded cases
                // shouldn't affect events since there we don't have classification and we use a nin condition
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
          .aggregate(
            aggregatePipeline, {
              allowDiskUse: true
            }
          );

        // get the records from the cursor
        return cursor.toArray();
      })
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
            return localizationHelper.getDateStartOfDay(date1).diff(localizationHelper.getDateStartOfDay(date2));
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
          recordData.lastGraphDate = recordData.date ?
            localizationHelper.getDateStartOfDay(recordData.date) :
            undefined;

          // determine firstGraphDate
          // - should be the oldest date from case.dateOfOnset / case.dateRanges.endDate / case.labResults.dateSampleTaken / event.date
          recordData.firstGraphDate = recordData.date ?
            localizationHelper.getDateStartOfDay(recordData.date) :
            undefined;

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
                const dateOfResult = localizationHelper.getDateStartOfDay(lab.dateOfResult);
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
              } else if (lab.dateSampleTaken) {
                // determine lastGraphDate
                const dateSampleTaken = localizationHelper.getDateStartOfDay(lab.dateSampleTaken);
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
              dateRange.startDate = dateRange.startDate ? localizationHelper.getDateStartOfDay(dateRange.startDate) : localizationHelper.getDateStartOfDay(recordData.date);

              // if we don't have an end date then we need to set the current date since this is still in progress
              dateRange.endDate = dateRange.endDate ? localizationHelper.getDateStartOfDay(dateRange.endDate) : localizationHelper.getDateStartOfDay();

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
            const dateOfOutcome = localizationHelper.getDateStartOfDay(recordData.dateOfOutcome);

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
            const dateOfBurial = localizationHelper.getDateStartOfDay(recordData.dateOfBurial);

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
          if (recordData.firstGraphDate) {
            response.minGraphDate = !response.minGraphDate ?
              recordData.firstGraphDate : (
                recordData.firstGraphDate.isBefore(response.minGraphDate) ?
                  recordData.firstGraphDate :
                  response.minGraphDate
              );
          }

          // determine the most recent case graph date
          if (recordData.lastGraphDate) {
            response.maxGraphDate = !response.maxGraphDate ?
              recordData.lastGraphDate : (
                recordData.lastGraphDate.isAfter(response.maxGraphDate) ?
                  recordData.lastGraphDate :
                  response.maxGraphDate
              );
          }

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
  Person.sanitizeVisualId = app.utils.helpers.sanitizePersonVisualId;

  /**
   * Count contacts/exposures for a list of records
   * @param outbreakId
   * @param personId
   * @param filter Where if count is true, Full filter otherwise
   * @param count
   */
  Person.findMarkedAsNotDuplicates = function (
    outbreakId,
    personId,
    filter,
    count
  ) {
    return app.models.person
      .findById(personId, {
        fields: [
          'id',
          'notDuplicatesIds'
        ]
      })
      .then((person) => {
        // person found ?
        if (!person) {
          return Promise.reject(app.utils.apiError.getError('RECORD_NOT_FOUND'));
        }

        // we don't have any records marked as not duplicates
        if (
          !person.notDuplicatesIds ||
          person.notDuplicatesIds.length < 1
        ) {
          return count ? 0 : [];
        }

        // construct query
        const where = {
          outbreakId: outbreakId,
          id: {
            inq: person.notDuplicatesIds
          }
        };

        // merge filter
        filter = filter || {};
        if (filter.where) {
          filter.where = {
            and: [
              where,
              filter.where
            ]
          };
        } else {
          filter.where = where;
        }

        // return records marked as not duplicates
        return count ?
          app.models.person.count(filter.where) :
          app.models.person.find(filter);
      });
  };

  /**
   * Count contacts/exposures for a list of records
   * @param options
   * @param outbreakId
   * @param personType
   * @param personId
   * @param addRecords Persons record ids that should be *merged* into current list of items that aren't duplicates
   * @param removeRecords Persons record ids that should be *removed* from the current list of items that aren't duplicates
   */
  Person.markAsOrNotADuplicate = function (
    options,
    outbreakId,
    personType,
    personId,
    addRecords,
    removeRecords
  ) {
    return app.models.person
      .findOne({
        where: {
          _id: personId,
          outbreakId: outbreakId,
          type: personType
        }
      })
      .then((person) => {
        // person found ?
        if (!person) {
          return Promise.reject(app.utils.apiError.getError('RECORD_NOT_FOUND'));
        }

        // add records to list of duplicates
        if (
          addRecords &&
          addRecords.length > 0
        ) {
          person.notDuplicatesIds = _.uniq([
            ...(person.notDuplicatesIds || []),
            ...addRecords
          ]);
        }

        // remove records from list of duplicates
        if (
          removeRecords &&
          removeRecords.length > 0
        ) {
          // map ids that we want to remove for easy access
          const removeRecordsMap = {};
          removeRecords.forEach((id) => {
            removeRecordsMap[id] = true;
          });

          // remove records from list of duplicates
          person.notDuplicatesIds = (person.notDuplicatesIds || []).filter((id) => {
            return !removeRecordsMap[id];
          });
        }

        // finished
        return person;
      })
      .then((person) => {
        // update record
        return person.updateAttributes({
          notDuplicatesIds: person.notDuplicatesIds || []
        }, options);
      })
      .then((person) => {
        // add record from list of duplicates
        const jobs = [];
        if (
          addRecords &&
          addRecords.length > 0
        ) {
          jobs.push(
            ...addRecords.map((recordId) => {
              return app.models.person
                .findById(recordId)
                .then((relatedRecord) => {
                  // add record id
                  relatedRecord.notDuplicatesIds = relatedRecord.notDuplicatesIds || [];
                  relatedRecord.notDuplicatesIds.push(person.id);
                  relatedRecord.notDuplicatesIds = _.uniq(relatedRecord.notDuplicatesIds);

                  // update
                  return relatedRecord.updateAttributes({
                    notDuplicatesIds: relatedRecord.notDuplicatesIds
                  }, options);
                });
            })
          );
        }

        // remove record from list of duplicates
        if (
          removeRecords &&
          removeRecords.length > 0
        ) {
          jobs.push(
            ...removeRecords.map((recordId) => {
              return app.models.person
                .findById(recordId)
                .then((relatedRecord) => {
                  // remove record id
                  relatedRecord.notDuplicatesIds = (relatedRecord.notDuplicatesIds || []).filter((notDuplicatesId) => {
                    return notDuplicatesId !== person.id;
                  });

                  // update
                  return relatedRecord.updateAttributes({
                    notDuplicatesIds: relatedRecord.notDuplicatesIds
                  }, options);
                });
            })
          );
        }

        // execute all jobs
        return Promise
          .all(jobs)
          .then(() => {
            return person;
          });
      })
      .then((person) => {
        return person.notDuplicatesIds;
      });
  };

  /**
   * Group count
   */
  Person.groupCount = (
    options,
    outbreakId,
    personType,
    filter,
    groupByProperty,
    nullGroupKey
  ) => {
    // initialization
    filter = filter || {};
    filter.where = filter.where || {};

    // update filter for geographical restriction if needed
    return Person
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then((updatedFilter) => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // attach prefilters
        filter.where.outbreakId = outbreakId;
        filter.where.type = personType;
        if (!filter.deleted) {
          filter.where.deleted = false;
        }

        // convert to mongo filter
        const mongoFilter = app.utils.remote.convertLoopbackFilterToMongo(filter);

        // filter by relationship ?
        // - case, contact ...
        let relationshipQuery;
        if (!_.isEmpty(mongoFilter.where.relationship)) {
          // get conditions
          relationshipQuery = mongoFilter.where.relationship;
        }

        // filter by case ?
        let relationshipCaseQuery;
        if (!_.isEmpty(mongoFilter.where.case)) {
          // get conditions
          relationshipCaseQuery = mongoFilter.where.case;
        }

        // filter by follow-up ?
        // - case, contact ...
        let followUpQuery;
        if (!_.isEmpty(mongoFilter.where.followUp)) {
          // get conditions
          followUpQuery = mongoFilter.where.followUp;
        }

        // cleanup
        delete mongoFilter.where.relationship;
        delete mongoFilter.where.case;
        delete mongoFilter.where.followUp;

        // start creating aggregate filters
        return Promise.resolve()
          // main query
          .then(() => {
            // construct aggregate filter
            return [{
              $match: mongoFilter.where
            }];
          })

          // relationship query
          .then((aggregateFilters) => {
            // filter by relationship ?
            if (
              relationshipQuery ||
              relationshipCaseQuery
            ) {
              // lookup
              aggregateFilters.push({
                $lookup: {
                  from: 'relationship',
                  localField: '_id',
                  foreignField: 'persons.id',
                  as: 'relationships'
                }
              });

              // search
              aggregateFilters.push({
                $match: {
                  relationships: {
                    $elemMatch: relationshipQuery ?
                      Object.assign(
                        {
                          deleted: false
                        },
                        relationshipQuery
                      ) : {
                        deleted: false
                      }
                  }
                }
              });
            }

            // finished
            return aggregateFilters;
          })

          // case query
          .then((aggregateFilters) => {
            // filter by relationship ?
            if (relationshipCaseQuery) {
              // add extra filters
              relationshipCaseQuery = app.utils.remote.mergeFilters(
                { where: relationshipCaseQuery },
                {
                  where: {
                    outbreakId
                  }
                }
              ).where;

              // filter
              return app.models.case
                .rawFind(
                  relationshipCaseQuery, {
                    projection: {
                      _id: 1
                    }
                  }
                )
                .then((cases) => {
                  // attach condition
                  aggregateFilters.push({
                    $match: {
                      'relationships.persons.id': {
                        $in: cases.map((caseItem) => caseItem.id)
                      }
                    }
                  });

                  // finished
                  return aggregateFilters;
                });
            }

            // finished
            return aggregateFilters;
          })

          // follow-up
          .then((aggregateFilters) => {
            // filter by follow-up ?
            if (followUpQuery) {
              // lookup
              aggregateFilters.push({
                $lookup: {
                  from: 'followUp',
                  localField: '_id',
                  foreignField: 'personId',
                  as: 'followUps'
                }
              });

              // search
              aggregateFilters.push({
                $match: {
                  followUps: {
                    $elemMatch: Object.assign({
                      deleted: false,

                    }, followUpQuery)
                  }
                }
              });
            }

            // finished
            return aggregateFilters;
          })

          // finishing touches
          .then((aggregateFilters) => {
            // group by classification
            aggregateFilters.push({
              $group: {
                _id: `$${groupByProperty}`,
                count: {
                  $sum: 1
                }
              }
            });

            // sort by group size
            aggregateFilters.push({
              $sort: {
                count: 1
              }
            });

            // retrieve data
            return app.dataSources.mongoDb.connector
              .collection('person')
              .aggregate(
                aggregateFilters, {
                  allowDiskUse: true
                }
              )
              .toArray();
          })

          // process data
          .then((data) => {
            // result
            const result = {
              [groupByProperty]: {},
              count: 0
            };

            // format
            (data || []).forEach((record) => {
              // count
              result[groupByProperty][record._id ? record._id : nullGroupKey] = {
                count: record.count
              };

              // count cases
              result.count += record.count;
            });

            // finished
            return result;
          });
      });
  };

  /**
   * Get alternate unique identifier query for sync/import actions
   * @param {Object} record
   * @returns {{outbreakId, visualId}|null}
   */
  Person.getAlternateUniqueIdentifierQueryForSync = (record) => {
    if (
      // alternate unique identifier key is outbreakId and visualId
      record.outbreakId !== undefined &&
      record.outbreakId !== null &&
      record.outbreakId !== '' &&
      record.visualId !== undefined &&
      record.visualId !== null &&
      record.visualId !== ''
    ) {
      return {
        outbreakId: record.outbreakId,
        visualId: record.visualId
      };
    }

    // record doesn't have an alternate unique identifier set
    return null;
  };
};
