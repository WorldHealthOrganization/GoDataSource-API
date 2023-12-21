'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const genericHelpers = require('../../components/helpers');
const templateParser = require('./../../components/templateParser');
const uuid = require('uuid');
const AdmZip = require('adm-zip');
const tmp = require('tmp');
const async = require('async');
const fs = require('fs');
const Platform = require('./../../components/platform');
// used to manipulate dates
const apiError = require('./../../components/apiError');
const localizationHelper = require('../../components/localizationHelper');
const fork = require('child_process').fork;
const pdfUtils = app.utils.pdfDoc;

module.exports = function (Outbreak) {

  Outbreak.fieldLabelsMap = Object.assign({}, Outbreak.fieldLabelsMap, {
    name: 'LNG_OUTBREAK_FIELD_LABEL_NAME',
    description: 'LNG_OUTBREAK_FIELD_LABEL_DESCRIPTION',
    disease: 'LNG_OUTBREAK_FIELD_LABEL_DISEASE',
    countries: 'LNG_OUTBREAK_FIELD_LABEL_COUNTRIES',
    'countries[].id': 'LNG_OUTBREAK_FIELD_LABEL_COUNTRY_ID',
    startDate: 'LNG_OUTBREAK_FIELD_LABEL_START_DATE',
    endDate: 'LNG_OUTBREAK_FIELD_LABEL_END_DATE',
    longPeriodsBetweenCaseOnset: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_LONG_PERIODS',
    periodOfFollowup: 'LNG_OUTBREAK_FIELD_LABEL_DURATION_FOLLOWUP_DAYS',
    frequencyOfFollowUp: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_FRECQUENCY',
    frequencyOfFollowUpPerDay: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_FRECQUENCY_P-ER_DAY',
    generateFollowUpsOverwriteExisting: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_OVERWRITE_EXISTING',
    generateFollowUpsKeepTeamAssignment: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_KEEP_TEAM_ASSIGNMENT',
    generateFollowUpsTeamAssignmentAlgorithm: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM',
    generateFollowUpsDateOfLastContact: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_DATE_OF_LAST_CONTACT',
    generateFollowUpsWhenCreatingContacts: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_WHEN_CREATING_CONTACTS',
    intervalOfFollowUp: 'LNG_OUTBREAK_FIELD_LABEL_INTERVAL_OF_FOLLOW_UPS',
    noDaysAmongContacts: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_AMONG_KNOWN_CONTACTS',
    noDaysInChains: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_IN_KNOWN_TRANSMISSION_CHAINS',
    noDaysNotSeen: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_NOT_SEEN',
    noLessContacts: 'LNG_OUTBREAK_FIELD_LABEL_LESS_THAN_X_CONTACTS',
    noDaysNewContacts: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_NEW_CONTACT',
    'fieldsToDisplayNode[]': 'LNG_OUTBREAK_FIELD_LABEL_FIELDS_TO_DISPLAY_NODE',
    caseInvestigationTemplate: 'LNG_OUTBREAK_FIELD_LABEL_CASE_INVESTIGATION_TEMPLATE',
    contactInvestigationTemplate: 'LNG_OUTBREAK_FIELD_LABEL_CONTACT_INVESTIGATION_TEMPLATE',
    eventInvestigationTemplate: 'LNG_OUTBREAK_FIELD_LABEL_EVENT_INVESTIGATION_TEMPLATE',
    caseFollowUpTemplate: 'LNG_OUTBREAK_FIELD_LABEL_CASE_FOLLOWUP_TEMPLATE',
    contactFollowUpTemplate: 'LNG_OUTBREAK_FIELD_LABEL_CONTACT_FOLLOWUP_TEMPLATE',
    labResultsTemplate: 'LNG_OUTBREAK_FIELD_LABEL_LAB_RESULTS_TEMPLATE',
    eventIdMask: 'LNG_OUTBREAK_FIELD_LABEL_EVENT_ID_MASK',
    caseIdMask: 'LNG_OUTBREAK_FIELD_LABEL_CASE_ID_MASK',
    contactIdMask: 'LNG_OUTBREAK_FIELD_LABEL_CONTACT_ID_MASK',
    contactOfContactIdMask: 'LNG_OUTBREAK_FIELD_LABEL_CONTACT_OF_CONTACT_ID_MASK',
    'arcGisServers': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVERS',
    'arcGisServers[].name': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_NAME',
    'arcGisServers[].url': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_URL',
    'arcGisServers[].type': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_TYPE',
    isContactLabResultsActive: 'LNG_OUTBREAK_FIELD_LABEL_IS_CONTACT_LAB_RESULTS_ACTIVE',
    applyGeographicRestrictions: 'LNG_OUTBREAK_FIELD_LABEL_APPLY_GEOGRAPHIC_RESTRICTIONS',
    checkLastContactDateAgainstDateOnSet: 'LNG_OUTBREAK_FIELD_LABEL_CHECK_LAST_CONTACT_DATE_AGAINST_DATE_OF_ONSET',
    disableModifyingLegacyQuestionnaire: 'LNG_OUTBREAK_FIELD_LABEL_DISABLE_MODIFYING_LEGACY_QUESTIONNAIRE',
    allowCasesFollowUp: 'LNG_OUTBREAK_FIELD_LABEL_ALLOW_CASES_FOLLOW_UP',
    periodOfFollowupCases: 'LNG_OUTBREAK_FIELD_LABEL_DURATION_FOLLOWUP_DAYS_CASES',
    frequencyOfFollowUpCases: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_FREQUENCY_CASES',
    frequencyOfFollowUpPerDayCases: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_FREQUENCY_PER_DAY_CASES',
    intervalOfFollowUpCases: 'LNG_OUTBREAK_FIELD_LABEL_INTERVAL_OF_FOLLOW_UPS_CASES',
    generateFollowUpsOverwriteExistingCases: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_OVERWRITE_EXISTING_CASES',
    generateFollowUpsKeepTeamAssignmentCases: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_KEEP_TEAM_ASSIGNMENT_CASES',
    generateFollowUpsTeamAssignmentAlgorithmCases: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM_CASES',
    generateFollowUpsDateOfOnset: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_DATE_OF_ONSET',
    generateFollowUpsWhenCreatingCases: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_GENERATION_WHEN_CREATING_CASES',
    allowedRefDataItems: 'LNG_OUTBREAK_FIELD_LABEL_ALLOWED_REF_DATA_ITEMS',
    visibleAndMandatoryFields: 'LNG_OUTBREAK_FIELD_LABEL_VISIBLE_AND_MANDATORY_FIELDS'
  });

  Outbreak.locationFields = [
    'locationIds'
  ];

  Outbreak.referenceDataFieldsToCategoryMap = {
    disease: 'LNG_REFERENCE_DATA_CATEGORY_DISEASE',
    'countries[].id': 'LNG_REFERENCE_DATA_CATEGORY_COUNTRY',
    generateFollowUpsTeamAssignmentAlgorithm: 'LNG_REFERENCE_DATA_CATEGORY_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM',
  };

  Outbreak.referenceDataFields = Object.keys(Outbreak.referenceDataFieldsToCategoryMap);

  // define a list of custom (non-loopback-supported) relations
  Outbreak.customRelations = {
    locations: {
      type: 'belongsToMany',
      model: 'location',
      foreignKey: 'locationIds'
    }
  };

  // initialize model helpers
  Outbreak.helpers = {};
  // set a higher limit for event listeners to avoid warnings (we have quite a few listeners)
  Outbreak.setMaxListeners(80);

  // The permissions that influence an user's ability to see a person's data
  Outbreak.personReadPermissions = [
    'case_all',
    'case_list',
    'case_view',
    'contact_all',
    'contact_list',
    'contact_view',
    'event_all',
    'event_list',
    'event_view',
    'contact_of_contact_all',
    'contact_of_contact_list',
    'contact_of_contact_view'
  ];

  // The fields that will be displayed when a user receives a person's data even though he does not
  // have permission to see it (ex. reports, chains of transmission, etc)
  Outbreak.noPersonReadPermissionFields = [
    'id',
    'type'
  ];

  // map person read permissions
  Outbreak.personReadPermissionMap = {
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'contact_list',
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'case_list',
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'event_list',
    'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT': 'contact_of_contact_list'
  };

  /**
   * Find relations for a person
   * @param personId
   * @param filter
   * @param callback
   */
  Outbreak.helpers.findPersonRelationships = function (personId, filter, callback) {
    const _filter = app.utils.remote
      .mergeFilters({
        where: {
          'persons.id': personId
        }
      }, filter);

    app.models.relationship
      .find(_filter)
      .then(function (relationships) {
        callback(null, relationships);
      })
      .catch(callback);
  };

  /**
   * Validate persons property
   * @param outbreakId
   * @param personId
   * @param type
   * @param data
   * @param checkVisualId True if we should check both id and visual id when searching for person
   * @param callback
   * @return {*}
   */
  Outbreak.helpers.validateAndNormalizePeople = function (outbreakId, personId, type, data, checkVisualId, callback) {
    // checkVisualId not provided ?
    if (!callback) {
      callback = checkVisualId;
      checkVisualId = undefined;
    }

    // do we have persons data ?
    if (Array.isArray(data.persons) && data.persons.length) {

      let errors = [];
      let persons = [];

      // We allow the user to send multiple persons in a create relationships request but we only use the first one.
      // We do this so that we can "silently" treat an user error.
      let person = {id: data.persons[0].id};

      // validate the person item
      if (person.id === undefined) {
        errors.push('"persons[0]" must contain "id"');
        // add only other people
      } else if (person.id === personId) {
        errors.push('You cannot link a person to itself');
      } else {
        persons.push(person);
      }

      // check validation errors
      if (errors.length) {
        return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: app.models.relationship.modelName,
          details: errors.join(', ')
        }));
      }

      data.persons = persons;

      // another person must be specified for a relation to be valid
      if (!data.persons.length) {
        return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: app.models.relationship.modelName,
          details: 'you must specify the related person'
        }));
      }

      // add current person
      if (data.persons.length) {
        data.persons.push({
          id: personId,
          type: type
        });
      }

      // keep a list of promises for finding person types
      let personPromises = [];
      data.persons.forEach(function (person, index) {
        if (!person.type) {
          // find each person
          personPromises.push(
            (!checkVisualId ?
              app.models.person.findById(person.id) :
              app.models.person.find({
                where: {
                  or: [
                    {_id: person.id},
                    {
                      outbreakId: outbreakId,
                      visualId: person.id
                    }
                  ]
                }
              }))
              .then(function (foundPerson) {
                // in case we searched by visualId
                if (
                  checkVisualId &&
                  foundPerson
                ) {
                  // we need to make sure we found only one record
                  if (foundPerson.length > 1) {
                    throw app.utils.apiError.getError('MODEL_VISUAL_ID_MATCHES_MORE_THAN_2_RECORDS', {
                      model: app.models.person.modelName,
                      visualId: person.id
                    });
                  }

                  // we need to convert array to model
                  foundPerson = foundPerson.length > 0 ? foundPerson[0] : null;

                  // check if we found the related person
                  if (!foundPerson) {
                    throw app.utils.apiError.getError('PERSON_NOT_FOUND', {
                      model: app.models.person.modelName,
                      id: person.id
                    });
                  }

                  // replace visualId with person id
                  person.id = foundPerson.id;
                }

                // check if we found the related person
                if (!foundPerson) {
                  throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                    model: app.models.person.modelName,
                    id: person.id
                  });
                }

                // do not allow relationships with discarded cases
                if (
                  foundPerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' &&
                  app.models.case.discardedCaseClassifications.includes(foundPerson.classification)
                ) {
                  throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
                    id: foundPerson.id
                  });
                }

                // set its type
                data.persons[index].type = foundPerson.type;

                // contact of contact can only be exposed to a contact
                if (data.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
                  data.persons[0].target = true;
                  data.persons[1].source = true;
                } else if (data.persons[1].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
                  data.persons[0].source = true;
                  data.persons[1].target = true;
                  // if the trying to link to an event or a case, set it as the source
                } else if (['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'].includes(data.persons[1].type)) {
                  data.persons[0].target = true;
                  data.persons[1].source = true;
                } else {
                  // If we are trying to link two contacts, keep the contact we are linking to as the source
                  if (data.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                    data.persons[0].target = true;
                    data.persons[1].source = true;
                    // If we are linking a case/event to a contact, set the contact as the target
                  } else {
                    data.persons[0].source = true;
                    data.persons[1].target = true;
                  }
                }
              })
          );
        }
      });
      // wait for all the searches to finis
      Promise.all(personPromises)
        .then(function () {
          callback(null, data.persons);
        })
        .catch(callback);
    } else {
      callback(null, data.persons);
    }
  };

  /**
   * Create relation for a person
   * @param outbreakId
   * @param personId
   * @param type
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.helpers.createPersonRelationship = function (outbreakId, personId, type, data, options, callback) {
    Outbreak.helpers.validateAndNormalizePeople(outbreakId, personId, type, data, function (error) {
      if (error) {
        return callback(error);
      }
      app.models.relationship.removeReadOnlyProperties(data, ['id']);
      app.models.relationship
        .create(Object.assign(data, {outbreakId: outbreakId}), options)
        .then(function (createdRelation) {
          callback(null, createdRelation);
        })
        .catch(callback);
    });
  };

  /**
   * Retrieve a relation for a person
   * @param personId
   * @param relationshipId
   * @param type
   * @param filter
   * @param callback
   */
  Outbreak.helpers.getPersonRelationship = function (personId, relationshipId, type, filter, callback) {
    const _filter = app.utils.remote
      .mergeFilters({
        where: {
          id: relationshipId,
          'persons.id': personId
        }
      }, filter);

    app.models.relationship
      .findOne(_filter)
      .then(function (relationship) {
        if (!relationship) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND_IN_CONTEXT', {
            model: app.models.relationship.modelName,
            id: relationshipId,
            contextModel: app.models[type].modelName,
            contextId: personId
          });
        }

        // retrieve person information
        app.models.relationship.retrieveUserSupportedRelations(
          {
            req: {
              options: {
                _userRelations: _.map(
                  app.models.relationship.userSupportedRelations,
                  (relName) => ({relation: relName})
                )
              }
            }
          },
          relationship,
          (err) => {
            // an error occurred ?
            if (err) {
              return callback(err);
            }

            // finished mapping user relations
            callback(null, relationship);
          }
        );
      })
      .catch(callback);
  };

  /**
   * Update a relation for a person
   * @param personId
   * @param relationshipId
   * @param type
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.helpers.updatePersonRelationship = function (personId, relationshipId, type, data, options, callback) {
    Outbreak.helpers.validateAndNormalizePeople(undefined, personId, type, data, function (error) {
      if (error) {
        return callback(error);
      }
      app.models.relationship
        .findOne({
          where: {
            id: relationshipId,
            'persons.id': personId
          }
        })
        .then(function (relationship) {
          if (!relationship) {
            throw app.utils.apiError.getError('MODEL_NOT_FOUND_IN_CONTEXT', {
              model: app.models.relationship.modelName,
              id: relationshipId,
              contextModel: app.models[app.models.person.typeToModelMap[type]].modelName,
              contextId: personId
            });
          }
          app.models.relationship.removeReadOnlyProperties(data);
          return relationship.updateAttributes(data, options);
        })
        .then(function (relationship) {
          callback(null, relationship);
        })
        .catch(callback);
    });
  };

  /**
   * Delete a relation for a person
   * Do not allow deletion of the last exposure relationship of a contact/contact of contact
   * @param personId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.helpers.deletePersonRelationship = function (personId, relationshipId, options, callback) {
    // initialize relationship instance; will be cached
    let relationshipInstance;

    // get the relationship
    app.models.relationship
      .findOne({
        where: {
          id: relationshipId,
          'persons.id': personId
        }
      })
      .then(function (relationship) {
        if (!relationship) {
          // ignore invalid relationship
          return;
        }

        // cache relationship
        relationshipInstance = relationship;

        // check if the relationship includes a contact or contact of contact
        let personRelationships = relationship.persons.filter(
          person => person.target &&
            ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'].includes(person.type)
        );

        // if there are only events/cases assume that there is at least another exposure
        if (!personRelationships.length) {
          return {count: 1};
        }

        // get the person
        const person = personRelationships[0];

        // count the exposure relationships excepting the current relationship
        const exposureTypes = person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT' ?
          ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'] :
          ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'];
        return app.models.relationship
          .rawCountDocuments({
            where: {
              id: {
                neq: relationshipId
              },
              // required to use index to improve greatly performance
              'persons.id': person.id,
              $or: [
                {
                  'persons.0.id': person.id,
                  'persons.0.target': true,
                  'persons.1.type': {
                    $in: exposureTypes
                  }
                },
                {
                  'persons.1.id': person.id,
                  'persons.1.target': true,
                  'persons.0.type': {
                    $in: exposureTypes
                  }
                }
              ]
            }
          }, {
            limit: 1,
            // required to use index to improve greatly performance
            hint: {
              'persons.id': 1
            }
          });
      })
      .then(function (response) {
        // ignore the invalid relationships
        if (!response) {
          return;
        }

        // throw error because no other exposure exist
        if (!response.count) {
          throw app.utils.apiError.getError('DELETE_CONTACT_LAST_RELATIONSHIP', {
            contactIDs: [personId]
          });
        }

        // delete relationship
        return relationshipInstance.destroy(options);
      })
      .then(function (relationship) {
        callback(null, relationship);
      })
      .catch(callback);
  };

  /**
   * Count relations for a person
   * @param personId
   * @param where
   * @param callback
   */
  Outbreak.helpers.countPersonRelationships = function (personId, where, callback) {
    const _filter = app.utils.remote.mergeFilters(
      {
        where: {
          'persons.id': personId
        }
      },
      {where: where});

    app.models.relationship
      .count(_filter.where)
      .then(function (relationships) {
        callback(null, relationships);
      })
      .catch(callback);
  };

  /**
   * Count filtered relations for a person
   * @param personId
   * @param filter
   * @param callback
   */
  Outbreak.helpers.filteredCountPersonRelationships = function (personId, filter, callback) {
    const _filter = app.utils.remote.mergeFilters(
      {
        where: {
          'persons.id': personId
        }
      },
      filter
    );

    app.models.relationship
      .find(_filter)
      .then((result) => {
        callback(null, app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(result, _filter).length);
      })
      .catch((error) => {
        callback(error);
      });
  };

  /**
   * Attach filter people without relation behavior (before remote hook)
   * @param context
   * @param modelInstance
   * @param next
   * @return {*}
   */
  Outbreak.helpers.attachFilterPeopleWithoutRelation = function (context, modelInstance, next) {
    // get custom noRelationships filter
    const noRelationship = _.get(context, 'args.filter.where.noRelationships', false);
    // remove custom filter before it reaches the model
    _.unset(context, 'args.filter.where.noRelationships');

    if (noRelationship) {
      // attach additional filtering for cases that have no relationships
      context.args.filter = app.utils.remote
        .mergeFilters({
          where: {
            hasRelationships: {
              neq: true
            }
          }
        }, context.args.filter);
    }

    return next();
  };

  /**
   * In case an event is provided then retrieve the next available event visual id, or if a visual id is provided check if
   * it matches the outbreak mask and it isn't a duplicate
   * @param outbreak
   * @param visualId
   * @param [eventId]
   * @return Visual ID or throws one of the following validation errors: DUPLICATE_VISUAL_ID / INVALID_VISUAL_ID_MASK
   */
  Outbreak.helpers.validateOrGetAvailableEventVisualId = function (outbreak, visualId, eventId) {
    // validate visualId uniqueness
    return Outbreak.helpers
      .validateVisualIdUniqueness(outbreak.id, visualId, eventId)
      .then(() => {
        // generate visual id accordingly to visualId mask
        return Outbreak.helpers.getAvailableVisualId(outbreak, 'eventIdMask', visualId, eventId);
      });
  };

  /**
   * In case a mask is provided then retrieve the next available case visual id, or if a visual id is provided check if
   * it matches the outbreak mask and it isn't a duplicate
   * @param outbreak
   * @param visualId
   * @param [personId]
   * @return Visual ID or throws one of the following validation errors: DUPLICATE_VISUAL_ID / INVALID_VISUAL_ID_MASK
   */
  Outbreak.helpers.validateOrGetAvailableCaseVisualId = function (outbreak, visualId, personId) {
    // validate visualId uniqueness
    return Outbreak.helpers
      .validateVisualIdUniqueness(outbreak.id, visualId, personId)
      .then(() => {
        // generate visual id accordingly to visualId mask
        return Outbreak.helpers.getAvailableVisualId(outbreak, 'caseIdMask', visualId, personId);
      });
  };

  /**
   * In case a mask is provided then retrieve the next available contact visual id, or if a visual id is provided check if
   * it matches the outbreak mask and it isn't a duplicate
   * @param outbreak
   * @param visualId
   * @param [personId]
   * @return Visual ID or throws one of the following validation errors: DUPLICATE_VISUAL_ID / INVALID_VISUAL_ID_MASK
   */
  Outbreak.helpers.validateOrGetAvailableContactVisualId = function (outbreak, visualId, personId) {
    // validate visualId uniqueness
    return Outbreak.helpers
      .validateVisualIdUniqueness(outbreak.id, visualId, personId)
      .then(() => {
        // generate visual id accordingly to visualId mask
        return Outbreak.helpers.getAvailableVisualId(outbreak, 'contactIdMask', visualId, personId);
      });
  };

  /**
   * If a mask is provided then retrieve the next available contact of contact visual id, or if a visual id is provided check if
   * it matches the outbreak mask and it isn't a duplicate
   * @param outbreak
   * @param visualId
   * @param [personId]
   * @return Visual ID or throws one of the following validation errors: DUPLICATE_VISUAL_ID / INVALID_VISUAL_ID_MASK
   */
  Outbreak.helpers.validateOrGetAvailableContactOfContactVisualId = function (outbreak, visualId, personId) {
    // validate visualId uniqueness
    return Outbreak.helpers
      .validateVisualIdUniqueness(outbreak.id, visualId, personId)
      .then(() => {
        // generate visual id accordingly to visualId mask
        return Outbreak.helpers.getAvailableVisualId(outbreak, 'contactOfContactIdMask', visualId, personId);
      });
  };

  /**
   * Get the next available visual id
   * @param outbreak
   * @param maskProperty
   * @param visualId
   * @param [personId]
   * @return {*}
   */
  Outbreak.helpers.getAvailableVisualId = function (outbreak, maskProperty, visualId, personId) {
    // get search regex for visual id template
    let maskRegExp = app.utils.maskField.convertMaskToSearchRegExp(outbreak[maskProperty], visualId);
    // if no search regex returned
    if (!maskRegExp) {
      // invalid mask error
      return Promise.reject(app.utils.apiError.getError('INVALID_VISUAL_ID_MASK', {
        visualIdTemplate: visualId,
        outbreakVisualIdMask: outbreak[maskProperty]
      }));
    }
    // if a personId was provided, check if current visualId is owned by that person (visual ID did not change value)
    let validateExistingId;
    if (personId !== undefined) {
      // try and find the person that owns the ID
      validateExistingId = app.models.person
        .findOne({
          where: {
            id: personId,
            outbreakId: outbreak.id,
            visualId: visualId,
          }
        })
        .then(function (person) {
          // if the person was found
          if (person) {
            // return its visual ID
            return person.visualId;
          }
        });
    } else {
      // no person ID, nothing to check
      validateExistingId = Promise.resolve();
    }

    return validateExistingId
      .then(function (validVisualId) {
        // visual id owned by current person
        if (validVisualId) {
          // leave it as is
          return validVisualId;
        }
        // find the the ID that matches the same pattern with the biggest index value
        return app.models.person
          .findOne({
            where: {
              outbreakId: outbreak.id,
              visualId: {
                regexp: maskRegExp
              }
            },
            deleted: true,
            order: 'visualId DESC'
          })
          .then(function (person) {
            // assume no record found, index 0
            let index = 0;
            // person found
            if (person) {
              // get it's numeric index
              index = app.utils.maskField.extractValueFromMaskedField(outbreak[maskProperty], person.visualId);
            }
            // get next index
            index++;
            // resolve the mask using the computed index
            return app.utils.maskField.resolveMask(outbreak[maskProperty], visualId, index);
          });
      });
  };

  /**
   * Get a resource link embedded in a QR Code Image (png) for a person
   * @param outbreak
   * @param type
   * @param personId
   * @param callback
   */
  Outbreak.helpers.getPersonQRResourceLink = function (outbreak, type, personId, callback) {
    callback(null, app.utils.qrCode.createResourceLink(type, {
      outbreakId: outbreak.id,
      [`${type}Id`]: personId
    }));
  };

  /**
   * Retrieve list of system reference data and outbreak's specific reference data; Returns the promise
   * @param outbreakId
   * @param filter Optional additional filter for the reference data
   */
  Outbreak.helpers.getSystemAndOwnReferenceData = function (outbreakId, filter) {
    const _filter = app.utils.remote.mergeFilters(
      {
        where: {
          or: [
            {
              outbreakId: {
                eq: null
              }
            },
            {
              outbreakId: outbreakId
            }
          ]
        }
      },
      filter
    );

    return app.models.referenceData
      .find(_filter);
  };

  /**
   * Restrict what users can see based on their assigned permissions
   * @param type
   * @param context
   */
  Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions = function (type, context) {
    /**
     * Create a restricted filter that will allow returning only the data from allowed fields
     * @param filter
     * @param allowedFields
     * @return {*}
     */
    function createRestrictedFilter(filter, allowedFields) {
      // restrict allowed fields
      filter.fields = allowedFields;
      // if there's a nested relation
      if (filter.include) {
        // always work with lists
        if (!Array.isArray(filter.include)) {
          filter.include = [filter.include];
        }
        let includes = [];
        // go through each relation
        filter.include.forEach(function (include) {
          // simple relation, restrict allowed fields
          if (typeof include === 'string') {
            includes.push({
              relation: include,
              scope: {
                fields: allowedFields
              }
            });
            // complex relation
          } else {
            // complex relation with scope
            if (include.scope) {
              // remove queries (as they may query unavailable data)
              delete include.scope.where;
              if (include.scope) {
                // process sub-scope
                include.scope = createRestrictedFilter(include.scope, allowedFields);
              }
              // no scope on relation, restrict allowed fields
            } else {
              include.scope = {
                fields: allowedFields
              };
            }
            // update includes
            includes.push(include);
          }
        });
        // update filter
        filter.include = includes;
      }
      // return processed filter
      return filter;
    }

    // get the list of permissions
    const permissions = _.get(context, 'req.authData.user.permissionsList', []);
    // get existing filter
    let filter = _.get(context, 'args.filter', {});
    // create a map of required permissions for each type
    let requiredPermissionMap = {
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'case_list',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'event_list',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'contact_list',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT': 'contact_of_contact_list'
    };
    // if the required permission is missing
    if (
      permissions.indexOf(requiredPermissionMap[type]) === -1 && (
        !app.models.role.permissionGroupMap ||
        !app.models.role.permissionGroupMap[requiredPermissionMap[type]] ||
        permissions.indexOf(app.models.role.permissionGroupMap[requiredPermissionMap[type]].groupAllId) === -1
      )
    ) {
      // use restricted field
      filter = createRestrictedFilter(filter, [...Outbreak.noPersonReadPermissionFields, 'relationships', 'persons', 'people']);
      // update filter
      _.set(context, 'args.filter', filter);
    }
  };

  /**
   * Count the persons by follow-up filter
   * Note: The persons are counted in total and per team. If a person is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param data Object containing outbreakId, follow-up flag name and result property
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.helpers.countPersonsByFollowUpFilter = function (
    data,
    filter,
    options,
    callback
  ) {
    // define specific variables
    let personModel;
    if (data.personType === genericHelpers.PERSON_TYPE.CASE) {
      personModel = app.models.case;
    } else {
      // contact
      personModel = app.models.contact;
    }

    filter = filter || {};
    // get options
    let resultProperty = data.resultProperty;

    // initialize result
    let results = {
      [resultProperty]: 0,
      contactIDs: [],
      teams: []
    };

    // retrieve relations queries
    const relationsQueries = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);

    // get contact query, if any
    let contactQuery = relationsQueries.contact;

    // get case query, if any
    const caseQuery = relationsQueries.case;

    // by default, find contacts does not perform any action
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (caseQuery) {
      // retrieve cases
      findContacts = findContacts
        .then(() => {
          return app.models.case
            .rawFind({
              and: [
                caseQuery, {
                  outbreakId: data.outbreakId,
                  deleted: false
                }
              ]
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: data.outbreakId,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          if (contactQuery) {
            contactQuery = {
              and: [
                contactQuery, {
                  id: {
                    inq: contactIds
                  }
                }
              ]
            };
          } else {
            contactQuery = {
              id: {
                inq: contactIds
              }
            };
          }
        });
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // add geographical restriction to filter if needed
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, contactQuery)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (contactQuery = updatedFilter);

            // no contact query
            if (!contactQuery) {
              return;
            }

            // if a contact query was specified
            return personModel
              .rawFind({and: [contactQuery, {outbreakId: data.outbreakId}]}, {projection: {_id: 1}})
              .then(function (contacts) {
                // return a list of contact ids
                return contacts.map(contact => contact.id);
              });
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        // build follow-up query
        let followUpQuery = {
          where: {
            and: [
              {
                outbreakId: data.outbreakId
              },
              data.followUpFilter,
              // restrict the list of follow-ups by person type
              {
                'contact.type': data.personType
              }
            ]
          }
        };
        // if there were restrictions applied to contacts
        if (contactIds) {
          // restrict follow-up query to those contacts
          followUpQuery.where.and.push({
            personId: {
              inq: contactIds
            }
          });
        }

        // get all the followups for the filtered period
        return app.models.followUp.findAggregate(app.utils.remote
          .mergeFilters(followUpQuery, filter || {}))
          .then(function (followups) {
            // get contact ids (duplicates are removed) from all follow ups
            results.contactIDs = [...new Set(followups.map((followup) => followup.personId))];
            results[resultProperty] = results.contactIDs.length;

            // initialize map of contacts to not count same contact twice
            let teams = {};

            followups.forEach(function (followup) {
              if (teams[followup.teamId]) {
                if (teams[followup.teamId].contactIDs.indexOf(followup.personId) === -1) {
                  teams[followup.teamId].contactIDs.push(followup.personId);
                }
              } else {
                teams[followup.teamId] = {
                  id: followup.teamId,
                  contactIDs: [followup.personId]
                };
              }
            });

            // update results.teams; sending array with teams information only for the teams that have contacts
            results.teams = _.values(teams)
              .map((teamEntry) => {
                teamEntry[resultProperty] = teamEntry.contactIDs.length;
                return teamEntry;
              })
              .filter(teamEntry => teamEntry[resultProperty]);

            // send response
            callback(null, results);
          });
      })
      .catch(callback);
  };

  /**
   * Build/Count new transmission chains from registered contacts who became cases
   * @param outbreak
   * @param filter
   * @param countOnly
   * @param options Options from request
   * @param callback
   */
  Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases = function (outbreak, filter, countOnly, options, callback) {
    // build a filter for finding cases who came from registered contacts and their relationships that appeared happened after they became cases
    const _filter =
      {
        where: {
          outbreakId: outbreak.id,
          wasContact: true,
          classification: {
            nin: app.models.case.discardedCaseClassifications
          }
        },
        fields: ['id', 'relationships', 'dateBecomeCase'],
        include: [
          {
            relation: 'relationships',
            scope: {
              fields: ['id', 'contactDate'],
              filterParent: true
            }
          }
        ]
      };

    // input case filter
    const caseFilter = _.get(filter, 'where.case');
    if (caseFilter) {
      // remove from original filter
      delete filter.where.case;

      // add to case filters
      _filter.where = {
        and: [
          _filter.where,
          caseFilter
        ]
      };
    }

    // start geographical restriction promise
    let geographicalRestrictionsQueryCache;
    app.models.person
      .addGeographicalRestrictions(options.remotingContext)
      .then(geographicalRestrictionsQuery => {
        geographicalRestrictionsQueryCache = geographicalRestrictionsQuery;

        // add geographical restrictions to case query
        if (geographicalRestrictionsQuery) {
          if (_filter.where.and) {
            _filter.where.and.push(geographicalRestrictionsQuery);
          } else {
            _filter.where = {
              and: [
                _filter.where,
                geographicalRestrictionsQuery
              ]
            };
          }
        }

        // find the cases
        return app.models.case
          .rawFind(_filter.where, {projection: {dateBecomeCase: 1}});
      })
      .then(function (cases) {
        // build a case map
        const caseMap = {};
        cases.forEach(function (caseRecord) {
          caseMap[caseRecord.id] = caseRecord;
          caseRecord.relationships = [];
        });

        // find relationships for those cases
        return app.models.relationship
          .rawFind({
            outbreakId: outbreak.id,
            'persons.id': {
              inq: Object.keys(caseMap)
            }
          }, {projection: {contactDate: 1, persons: 1}})
          .then(function (relationships) {
            // add relationships to cases
            relationships.forEach(function (relationship) {
              Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
                if (caseMap[person.id]) {
                  caseMap[person.id].relationships.push(relationship);
                }
              });
            });
            // remove those without relations
            cases = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(cases, _filter);
            // keep a list of relationIds
            const relationshipIds = [];
            // go through all the cases
            cases.forEach(function (caseRecord) {
              if (Array.isArray(caseRecord.relationships)) {
                // go trough their relationships
                caseRecord.relationships.forEach(function (relationship) {
                  // store only the relationships that are newer than their conversion date
                  if (localizationHelper.getDateStartOfDay(relationship.contactDate) >= localizationHelper.getDateStartOfDay(caseRecord.dateBecomeCase)) {
                    relationshipIds.push(relationship.id);
                  }
                });
              }
            });

            // construct filter that will be used to construct cot data
            const cotFilter = app.utils.remote.mergeFilters(
              {
                where: {
                  id: {
                    inq: relationshipIds
                  }
                }
              },
              filter || {}
            );

            // do we need to restrict cot field ?
            if (filter.retrieveFields !== undefined) {
              cotFilter.retrieveFields = filter.retrieveFields;
            }

            // build/count transmission chains starting from the found relationIds
            app.models.relationship.buildOrCountTransmissionChains(
              outbreak.id,
              outbreak.periodOfFollowup,
              cotFilter,
              countOnly,
              false,
              false,
              geographicalRestrictionsQueryCache,
              callback
            );
          });
      })
      .catch(callback);
  };

  /**
   * Validates whether a given visual identifier is unique per given outbreak
   * If not, then a DUPLICATE_VISUAL_ID error is built and returned
   * @param outbreakId Outbreaks identifier
   * @param visualId Visual identifier (string)
   * @param [instanceId] Current instance id
   * @returns Promise { false (if unique), error }
   */
  Outbreak.helpers.validateVisualIdUniqueness = function (outbreakId, visualId, instanceId) {
    return app.models.person
      .findOne({
        where: {
          outbreakId: outbreakId,
          visualId: visualId,
          id: {
            neq: instanceId
          }
        },
        deleted: true
      })
      .then((instance) => {
        if (!instance) {
          // is unique, returning sent id
          return visualId;
        }
        // not unique, return crafted error
        throw app.utils.apiError.getError('DUPLICATE_VISUAL_ID', {
          id: visualId
        });
      });
  };

  /**
   * Merge 2 or more 'person' models of the same type
   * @base base model to be merged upon
   * @people list of 'person' models to be merged into 'base'
   * @type person type: case/contact supported
   */
  Outbreak.helpers.mergePersonModels = function (base, people, type) {
    // declare list of properties specific for case/contacts
    const contactProps = [
      'riskLevel',
      'riskReason',
      'wasCase',
      'dateBecomeContact',
      'followUpHistory'
    ];
    const caseProps = [
      'dateOfInfection',
      'dateOfOnset',
      'isDateOfOnsetApproximate',
      'wasContact',
      'dateBecomeCase',
      'outcomeId',
      'dateOfOutcome',
      'safeBurial',
      'dateOfBurial',
      'classification',
      'classificationHistory',
      'riskLevel',
      'riskReason',
      'transferRefused',
      'dateOfReporting',
      'isDateOfReportingApproximate'
    ];

    // the following contact props are array and should be treated differently
    const contactArrayProps = [
      'followUpHistory'
    ];

    // the following case props are array and should be treated differently
    const caseArrayProps = [
      'dateRanges',
      'classificationHistory'
    ];

    // decide which type of properties map to use, based on given type
    let propsMap = type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ? caseProps : contactProps;

    // get reference to properties of the base model
    let baseProps = base.__data;

    // list of properties that should be looked upon, levels below
    let missingProps = [];

    // iterate over case predefined props map
    for (let propName in propsMap) {
      // make sure the property is belonging to the model
      // note: undefined, null are taken into consideration as well
      // doing abstract equality, to check for both undefined/null values
      if (!baseProps.hasOwnProperty(propName) || baseProps[propName] == null) {
        missingProps.push(propName);
      }
    }

    // start working the properties that were missing in the base case
    missingProps.forEach((prop) => {
      for (let i = 1; i < people.length; i++) {
        let props = people[i].__data;
        if (props.hasOwnProperty(prop) && props[prop] !== null) {
          baseProps[prop] = props[prop];
          break;
        }
      }
    });

    // merge all case array props
    if (type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
      caseArrayProps.forEach((arrayProp) => {
        baseProps[arrayProp] = baseProps[arrayProp] || [];
        baseProps[arrayProp] = baseProps[arrayProp].concat(
          ...people
            .filter((item) => item[arrayProp])
            .map((item) => item[arrayProp])
        );
      });
    }

    // merge all contact array props
    if (type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
      contactArrayProps.forEach((arrayProp) => {
        baseProps[arrayProp] = baseProps[arrayProp] || [];
        baseProps[arrayProp] = baseProps[arrayProp].concat(
          ...people
            .filter((item) => item[arrayProp])
            .map((item) => item[arrayProp])
        );
      });
    }

    // merge all address
    baseProps.addresses = baseProps.addresses || [];
    baseProps.addresses = baseProps.addresses.concat(
      ...people
        .filter((item) => item.addresses)
        .map((item) => item.addresses)
    );

    // merge all documents, accept only unique type,number combination
    baseProps.documents = baseProps.documents || [];
    baseProps.documents = baseProps.documents.concat(
      ...people
        .filter((item) => item.documents)
        .map((item) => {
          return item.documents.filter((doc) => baseProps.documents.findIndex((resultItem) => {
            return resultItem.type === doc.type && resultItem.number === doc.number;
          }) === -1);
        })
    );

    return base;
  };

  /**
   * Exclude inactive top level and additional questions
   * @param questions
   */
  Outbreak.helpers.excludeInactiveQuestions = function (questions) {
    return (function filterInactive(list) {
      return list.filter((q) => {
        // no reason for additional checks
        if (q.inactive) {
          return false;
        }

        // defensive check
        // even tho answers is of type array, null value is still valid
        q.answers = q.answers || [];

        // filter additional questions as well
        // this will alter the array item
        if (q.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER'
          || q.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
          q.answers.forEach((answer) => {
            answer.additionalQuestions = answer.additionalQuestions ? filterInactive(answer.additionalQuestions) : [];
          });
        }

        // array item should be in the filtered list if top level is not inactive
        return true;
      });
    })(questions);
  };

  /**
   * Parse a outbreak template's questions by translating any tokens based on given dictionary reference
   * Function works recursive by translating any additional questions of the answers
   * Optional feature: Remove inactive questions
   * @param questions
   * @param dictionary
   * @param excludeInactive
   */
  Outbreak.helpers.parseTemplateQuestions = function (questions, dictionary, excludeInactive = true) {
    // cache translation function name, used in many places below
    // include sanity check, fallback on initial value if no translation is found
    let translateToken = function (text) {
      let translatedText = dictionary.getTranslation(text);
      return translatedText ? translatedText : text;
    };

    // filter questions of type FILE UPLOAD
    let filteredQuestions = _.filter(
      questions,
      question => question.answerType !== 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD'
    );

    // filter inactive questions
    if (excludeInactive) {
      filteredQuestions = Outbreak.helpers.excludeInactiveQuestions(filteredQuestions);
    }

    // Translate all the questions, including additional questions of the answers
    return (function translate(list) {
      return list.map((question, index) => {
        let questionResult = {
          order: ++index,
          question: translateToken(question.text),
          variable: question.variable,
          answerType: question.answerType,
          answers: question.answers,
          multiAnswer: question.multiAnswer,
          answersDisplay: question.answersDisplay
        };

        // do not try to translate answers that are free text
        if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER'
          || question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
          questionResult.answers = question.answers.map((answer) => {
            if (answer.additionalQuestions && answer.additionalQuestions.length) {
              // we don't support horizontal display for answers with additional questions
              questionResult.answersDisplay = 'LNG_OUTBREAK_QUESTIONNAIRE_ANSWERS_DISPLAY_ORIENTATION_VERTICAL';
            }
            return {
              label: translateToken(answer.label),
              value: answer.value,
              additionalQuestions: translate(answer.additionalQuestions || [])
            };
          });
        }

        return questionResult;
      });
    })(filteredQuestions);
  };

  /**
   * Get the user's person read permissions
   * @param context
   * @returns {*}
   */
  Outbreak.helpers.getUsersPersonReadPermissions = function (context) {
    let userPermissions = context.req.authData.user.permissionsList;

    // Keep only the read person permissions that the user has
    let personReadPermissions = (userPermissions.filter(value => -1 !== Outbreak.personReadPermissions.indexOf(value)));

    // Keep only the unique values
    personReadPermissions = [...new Set(personReadPermissions)];

    return personReadPermissions;
  };

  /**
   * Checks if a person type is a disallowed type
   * @param permissions
   * @param type
   */
  Outbreak.helpers.isDisallowedPersonType = function (permissions, type) {
    return permissions.indexOf(Outbreak.personReadPermissionMap[type]) === -1 && (
      !app.models.role.permissionGroupMap ||
      !app.models.role.permissionGroupMap[Outbreak.personReadPermissionMap[type]] ||
      permissions.indexOf(app.models.role.permissionGroupMap[Outbreak.personReadPermissionMap[type]].groupAllId) === -1
    );
  };

  /**
   * Returns the disallowed person types
   * @param permissions
   */
  Outbreak.helpers.getDisallowedPersonTypes = function (permissions) {
    let disallowedPersonTypes = [];
    Object.keys(Outbreak.personReadPermissionMap).forEach((personType) => {
      if (Outbreak.helpers.isDisallowedPersonType(permissions, personType)) {
        disallowedPersonTypes.push(personType);
      }
    });

    // return the disallowed types
    return disallowedPersonTypes;
  };

  /**
   * Hide fields that the user does not have permission to see on a person model (case/contact/event/contactOfContact)
   * @param model
   * @param permissions
   */
  Outbreak.helpers.limitPersonInformation = function (model, permissions) {
    if (Outbreak.helpers.isDisallowedPersonType(permissions, model.type)) {
      for (let key in model) {
        if (Outbreak.noPersonReadPermissionFields.indexOf(key) === -1) {
          delete model[key];
        }
      }
    }
  };

  const mapStandardAnswerToQuestion = function (answers, qAnswer, question) {
    if (!question.multiAnswer &&
      Array.isArray(qAnswer) &&
      qAnswer.length &&
      qAnswer[0].date) {
      // find the answer that matches the date the question has
      qAnswer = qAnswer.find(a => localizationHelper.toMoment(a.date).format('YYYY-MM-DD') === question.multiAnswerDate);
    } else {
      if (Array.isArray(qAnswer) && qAnswer.length) {
        qAnswer = qAnswer[0];
      }
    }
    qAnswer = qAnswer ? qAnswer.value : null;
    if (Array.isArray(question.answers) && question.answers.length && !Array.isArray(qAnswer)) {
      qAnswer = [qAnswer];
    }
    if (Array.isArray(qAnswer) && qAnswer.length) {
      question.answers.forEach((answer) => {
        if (qAnswer.indexOf(answer.value) !== -1) {
          answer.selected = true;
        }
        if (answer.additionalQuestions && answer.additionalQuestions.length) {
          answer.additionalQuestions = Outbreak.helpers.prepareQuestionsForPrint(answers, answer.additionalQuestions, question.multiAnswerDate);
        }
      });
    } else {
      if (qAnswer instanceof Date || localizationHelper.isValidDate(qAnswer)) {
        question.value = localizationHelper.getDateDisplayValue(qAnswer);
      } else {
        question.value = qAnswer;
      }
    }
  };

  /**
   * Format the questions object for easier printing
   * @param answers
   * @param questions
   * @param multiAnswerDate
   */
  Outbreak.helpers.prepareQuestionsForPrint = function (answers, questions, multiAnswerDate) {
    questions.forEach((question) => {
      let qAnswer = answers[question.variable];

      if (qAnswer) {
        if (question.multiAnswer) {
          question.multiAnswers = [];
          qAnswer.forEach(answer => {
            const clonedQ = _.cloneDeep(question);
            clonedQ.value = null;
            clonedQ.multiAnswerDate = localizationHelper.toMoment(answer.date).format('YYYY-MM-DD');
            mapStandardAnswerToQuestion(answers, answer, clonedQ);
            question.multiAnswers.push({
              date: clonedQ.multiAnswerDate,
              answers: clonedQ.answers,
              value: clonedQ.value
            });
          });
        } else {
          if (multiAnswerDate) {
            question.multiAnswerDate = multiAnswerDate;
          }
          mapStandardAnswerToQuestion(answers, qAnswer, question);
        }
      }
    });

    return questions;
  };

  /**
   * Find the list of people or count the people in a cluster
   * @param clusterId
   * @param filter
   * @param countOnly
   * @param options
   * @param callback
   */
  Outbreak.prototype.findOrCountPeopleInCluster = function (clusterId, filter, countOnly, options, callback) {
    // find the requested cluster
    app.models.cluster
      .findOne({
        where: {
          id: clusterId,
          outbreakId: this.id
        }
      })
      .then(function (cluster) {
        // if the cluster was not found
        if (!cluster) {
          // stop with error
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.cluster.modelName,
            id: clusterId
          }));
        }

        // otherwise find people in that cluster
        cluster.findOrCountPeople(filter, countOnly, options, callback);
      });
  };

  /**
   * On create/update parse questions/answers
   */
  Outbreak.observe('before save', function (context, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse template
    templateParser.beforeHook(context, next);
  });

  /**
   * On create/update save questions/answers tokens
   */
  Outbreak.observe('after save', function (context, next) {
    // after successfully creating template, also create translations for it.
    templateParser.afterHook(
      context, (err) => {
        // error ?
        if (err) {
          next(err);
        }

        // on outbreak creation we need to add it to use whitelist in case user doesn't have access to all outbreaks
        if (
          context.isNewInstance &&
          _.get(context, 'options.remotingContext.req.authData.userInstance') &&
          _.get(context, 'instance.id')
        ) {
          const authentificatedUser = context.options.remotingContext.req.authData.userInstance;
          const outbreakId = context.instance.id;
          if (
            !_.isEmpty(authentificatedUser.outbreakIds) &&
            authentificatedUser.outbreakIds.indexOf(outbreakId) < 0
          ) {
            // add outbreak to the list
            authentificatedUser.outbreakIds.push(outbreakId);

            // save user
            authentificatedUser
              .updateAttributes({
                outbreakIds: authentificatedUser.outbreakIds
              })
              .then(() => {
                next();
              })
              .catch(next);
          } else {
            next();
          }
        } else {
          next();
        }
      }
    );
  });

  /**
   * On update, update contact followup start date, end date
   */
  Outbreak.observe('after save', function (context, next) {
    // return if it's a new record or there is no changed field
    if (
      context.isNewInstance ||
      !context.options.changedFields ||
      context.options.changedFields.length === 0
    ) {
      return next();
    }

    // return if the changed fields are not 'Duration for the follow-up period in days' or 'Contact tracing should start on the date of the last contact'"
    let followUpFieldsChanged = false;
    for (let i = 0; i < context.options.changedFields.length; i++) {
      if (
        context.options.changedFields[i].field === 'periodOfFollowup' ||
        context.options.changedFields[i].field === 'generateFollowUpsDateOfLastContact'
      ) {
        followUpFieldsChanged = true;
        break;
      }
    }
    if (!followUpFieldsChanged) {
      return next();
    }

    // since the query can return many results we will do the update in batches
    // Note: Updating each contact one by one in order for the "before/after save" hooks to be executed for each entry
    // Number of find requests at the same time
    // Don't set this value to high so we don't exceed Mongo 16MB limit
    const findBatchSize = 1000;

    // set how many item update actions to run in parallel
    const updateBatchSize = 10;

    // update all contacts (including deleted)
    // set a flag in context.options needed for triggers
    context.options.updateDeletedRecords = true;
    const where = {
      outbreakId: context.instance.id
    };

    // initialize parameters for handleActionsInBatches call
    const getActionsCount = () => {
      return app.models.contact
        .count(Object.assign({}, where, { includeDeletedRecords: true }));
    };

    // get records in batches
    const getBatchData = (batchNo, batchSize) => {
      // get contacts for batch
      return app.models.contact
        .find({
          deleted: true,
          where: where,
          fields: {
            id: true,
            deleted: true,
            outbreakId: true,
            type: true,
            followUp: true
          },
          skip: (batchNo - 1) * batchSize,
          limit: batchSize,
          order: 'createdAt ASC'
        });
    };

    // update contact
    const itemAction = (contact) => {
      const contactOptions = Object.assign({}, context.options);
      return app.models.contact.determineFollowUpDates(
        () => Promise.resolve(context.instance),
        contact.id,
        contact.deleted,
        contact.followUp,
        contactOptions
      )
        .then((data) => {
          // no property to update ?
          if (!data) {
            return;
          }

          // update contact
          return contact.updateAttributes(
            data,
            contactOptions
          );
        });
    };

    // process data in batches
    genericHelpers.handleActionsInBatches(
      getActionsCount,
      getBatchData,
      null,
      itemAction,
      findBatchSize,
      updateBatchSize,
      context.options.remotingContext.req.logger
    )
      .then(() => {
        next();
      })
      .catch((err) => next(err));
  });

  /**
   * On update, update case followup start date, end date
   */
  Outbreak.observe('after save', function (context, next) {
    // return if it's a new record or there is no changed field
    if (
      context.isNewInstance ||
      !context.options.changedFields ||
      context.options.changedFields.length === 0
    ) {
      return next();
    }

    // return if the changed fields are not 'Duration for the follow-up period in days' or 'Case tracing should start on the date of onset'"
    let followUpFieldsChanged = false;
    for (let i = 0; i < context.options.changedFields.length; i++) {
      if (
        context.options.changedFields[i].field === 'periodOfFollowupCases' ||
        context.options.changedFields[i].field === 'generateFollowUpsDateOfOnset'
      ) {
        followUpFieldsChanged = true;
        break;
      }
    }
    if (!followUpFieldsChanged) {
      return next();
    }

    // since the query can return many results we will do the update in batches
    // Note: Updating each case one by one in order for the "before/after save" hooks to be executed for each entry
    // Number of find requests at the same time
    // Don't set this value to high so we don't exceed Mongo 16MB limit
    const findBatchSize = 1000;

    // set how many item update actions to run in parallel
    const updateBatchSize = 10;

    // update all cases (including deleted)
    // set a flag in context.options needed for triggers
    context.options.updateDeletedRecords = true;
    const where = {
      outbreakId: context.instance.id
    };

    // initialize parameters for handleActionsInBatches call
    const getActionsCount = () => {
      return app.models.case
        .count(Object.assign({}, where, { includeDeletedRecords: true }));
    };

    // get records in batches
    const getBatchData = (batchNo, batchSize) => {
      // get cases for batch
      return app.models.case
        .find({
          deleted: true,
          where: where,
          fields: {
            id: true,
            deleted: true,
            outbreakId: true,
            type: true,
            dateOfOnset: true,
            followUp: true
          },
          skip: (batchNo - 1) * batchSize,
          limit: batchSize,
          order: 'createdAt ASC'
        });
    };

    // update case
    const itemAction = (record) => {
      const caseOptions = Object.assign({}, context.options);
      return app.models.case.determineFollowUpDates(
        () => Promise.resolve(context.instance),
        record.id,
        record.dateOfOnset,
        record.followUp,
        caseOptions
      )
        .then((data) => {
          // no property to update ?
          if (!data) {
            return;
          }

          // update contact
          return record.updateAttributes(
            data,
            caseOptions
          );
        });
    };

    // process data in batches
    genericHelpers.handleActionsInBatches(
      getActionsCount,
      getBatchData,
      null,
      itemAction,
      findBatchSize,
      updateBatchSize,
      context.options.remotingContext.req.logger
    )
      .then(() => {
        next();
      })
      .catch((err) => next(err));
  });

  // on load, include default ArcGis servers
  Outbreak.observe('loaded', function (context, next) {
    // if the outbreak does not have ArcGis servers defined
    if (
      !context.data.arcGisServers ||
      !Array.isArray(context.data.arcGisServers) ||
      !context.data.arcGisServers.length
    ) {
      // use default ArcGis servers
      context.data.arcGisServers = app.models.systemSettings.getDefaultArcGisServers();
    }

    // make sure the questions are ordered on load. This was made on on-load vs before save for simplicity
    // even though it will perform better on before save, there is a lot of logic that can be broken by affecting that code now
    // and a refactoring is already planned for questionnaires
    [
      'caseInvestigationTemplate',
      'contactInvestigationTemplate',
      'eventInvestigationTemplate',
      'caseFollowUpTemplate',
      'contactFollowUpTemplate',
      'labResultsTemplate'
    ]
      .forEach(function (template) {
        templateParser.orderQuestions(context.data[template]);
      });

    next();
  });

  /**
   * Resolve person visual id template, if visualId field present
   * @param outbreak
   * @param visualId
   * @param personType
   * @param [personId]
   * @return {*}
   */
  Outbreak.helpers.resolvePersonVisualIdTemplate = function (outbreak, visualId, personType, personId) {
    // if the field is present
    if (typeof visualId === 'string' && visualId.length) {
      // decide what type of visual id should we resolve based on the person type
      let maskProperty = null;
      switch (personType) {
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
        default:
          maskProperty = 'caseIdMask';
      }
      // validate its uniqueness
      return Outbreak.helpers
        .validateVisualIdUniqueness(outbreak.id, visualId, personId)
        .then(() => {
          // get the next available visual id for the visual id template
          return Outbreak.helpers.getAvailableVisualId(outbreak, maskProperty, visualId, personId);
        });
    } else {
      // nothing to resolve
      return Promise.resolve();
    }
  };

  /**
   * Print an empty case investigation, for either a new or an existing case
   * @param outbreakInstance
   * @param pdfUtils
   * @param copies default to 1
   * @param foundCase
   * @param options
   * @param callback
   */
  Outbreak.helpers.printCaseInvestigation = function (outbreakInstance, pdfUtils, copies = 1, foundCase, options, callback) {
    const models = app.models;
    let caseInvestigationTemplate = outbreakInstance.caseInvestigationTemplate;
    let labResultsTemplate = outbreakInstance.labResultsTemplate;
    let generatedId = '';
    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    // authenticated user's language, used to know in which language to translate
    let languageId = options.remotingContext.req.authData.userInstance.languageId;

    // load user language dictionary
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      // handle errors
      if (error) {
        return callback(error);
      }

      // translate contact/case sections
      const translateCaseContactSectionLabels = function (model) {
        const underlineCount = 6;
        const sections = {};
        const templateLabels = models[model].sectionsFieldLabels;
        for (const section in templateLabels) {
          sections[section] = {
            title: dictionary.getTranslation(templateLabels[section].title),
            labels: templateLabels[section].labels.map((label) => {
              const translation = dictionary.getTranslation(label);
              // AGE and DOB have custom label values
              let ageLabel = 'LNG_CASE_FIELD_LABEL_AGE';
              let dobLabel = 'LNG_CASE_FIELD_LABEL_DOB';
              if (model === 'contact') {
                ageLabel = 'LNG_CONTACT_FIELD_LABEL_AGE';
                dobLabel = 'LNG_CONTACT_FIELD_LABEL_DOB';
              }
              if (label === ageLabel) {
                return {
                  name: translation,
                  value: '_'.repeat(underlineCount) +
                    dictionary.getTranslation('LNG_AGE_LABEL_YEARS') +
                    '_'.repeat(underlineCount) +
                    dictionary.getTranslation('LNG_AGE_LABEL_MONTHS')
                };
              }
              if (label === dobLabel) {
                return {
                  name: translation,
                  value: '_'.repeat(underlineCount) +
                    dictionary.getTranslation('LNG_DOB_LABEL_DAY') +
                    '_'.repeat(underlineCount) +
                    dictionary.getTranslation('LNG_DOB_LABEL_MONTH') +
                    '_'.repeat(underlineCount) +
                    dictionary.getTranslation('LNG_DOB_LABEL_YEAR')
                };
              }
              return translation;
            })
          };

          if (section === 'addresses') {
            sections[section].additionalTitles = [
              dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE'),
              dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_OTHER')
            ];
          }

          if (section === 'addresses' || section === 'documents') {
            sections[section].copies = 2;
          }
        }
        return sections;
      };

      // translate case investigation labels
      const caseSections = translateCaseContactSectionLabels(models.case.modelName);
      const contactSections = translateCaseContactSectionLabels(models.contact.modelName);

      // remove not needed properties from lab result/relationship field maps
      let relationFieldsMap = Object.assign({}, models.relationship.fieldLabelsMap);
      let labResultFieldsMap = Object.assign({}, models.labResult.fieldLabelsMap);
      delete labResultFieldsMap.personId;
      delete relationFieldsMap.persons;

      let labResultsFields = genericHelpers.translateFieldLabels(app, labResultFieldsMap, models.labResult.modelName, dictionary);
      let relationFields = genericHelpers.translateFieldLabels(app, relationFieldsMap, models.relationship.modelName, dictionary);

      // translate template questions
      let caseQuestions = Outbreak.helpers.parseTemplateQuestions(caseInvestigationTemplate, dictionary);
      let labQuestions = Outbreak.helpers.parseTemplateQuestions(labResultsTemplate, dictionary);

      let pdfRequests = [];

      // standard PDF sizes
      const docFontSize = 9;

      // QR code options
      const qrOpts = {
        fontSize: 7,
        displayDashLines: false,
        imageSize: {
          width: 75,
          height: 75
        },
        identifierPosition: {
          x: 380,
          y: 90
        },
        imagePosition: {
          x: 495
        }
      };

      // setup go-data title on the left and QR code on the right
      const setupPageHeader = function (doc) {
        // we start text after document title and QR code
        doc.moveDown(7);

        // make the content a bit more centered
        doc.x = doc.x + 30;

        // we use a lower font size for QR, to not break the line
        app.utils.qrCode.addPersonQRCode(doc, outbreakInstance.id, 'case', foundCase || generatedId, qrOpts);
      };

      for (let i = 0; i < copies; i++) {
        pdfRequests.push(
          (callback) => {
            // generate pdf document
            let doc = pdfUtils.createPdfDoc({
              fontSize: docFontSize,
              layout: 'portrait',
              lineGap: 0,
              wordSpacing: 0,
              characterSpacing: 0,
              paragraphGap: 0
            });

            if (!foundCase) {
              generatedId = uuid.v4();
            }

            // additional options for document
            const additionalOpts = {
              titlePosition: {
                x: doc.options.margin + 20,
                y: 60
              }
            };

            // add functionality whenever a new page is added
            doc.on('pageAdded', () => {
              setupPageHeader(doc);
            });

            // apply page header to first page
            // event 'pageAdded' is not called when creating the document
            setupPageHeader(doc);

            // add case profile fields (empty)
            pdfUtils.displaySections(doc, caseSections, dictionary.getTranslation('LNG_PAGE_TITLE_CASE_DETAILS'), additionalOpts);

            // add case investigation questionnaire into the pdf in a separate page (only if the questionnaire exists)
            if (caseQuestions && caseQuestions.length) {
              doc.addPage();
              pdfUtils.createQuestionnaire(doc, caseQuestions, false, dictionary.getTranslation('LNG_PAGE_TITLE_CASE_QUESTIONNAIRE'), additionalOpts);
            }

            // add lab results information into a separate page
            doc.addPage();
            pdfUtils.displayResourceLabels(doc, Object.keys(labResultsFields), dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_DETAILS'), additionalOpts);

            // add lab results questionnaire into a separate page (only if the questionnaire exists)
            if (labQuestions && labQuestions.length) {
              doc.addPage();
              pdfUtils.createQuestionnaire(doc, labQuestions, false, dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_QUESTIONNAIRE'), additionalOpts);
            }

            // add contact relation template
            doc.addPage();
            pdfUtils.displaySections(doc, contactSections, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'), additionalOpts);
            doc.addPage();
            pdfUtils.displayResourceLabels(doc, Object.keys(relationFields), dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_RELATIONSHIP'), additionalOpts);

            // add an additional empty page that contains only the QR code as per requirements
            doc.addPage();

            // end the document stream
            // to convert it into a buffer
            doc.end();

            // convert pdf stream to buffer and send it as response
            genericHelpers.streamToBuffer(doc, (err, buffer) => {
              if (err) {
                callback(err);
              } else {
                fs.writeFile(`${tmpDirName}/${foundCase ? foundCase.id : generatedId}.pdf`, buffer, (err) => {
                  if (err) {
                    callback(err);
                  } else {
                    callback(null, null);
                  }
                });
              }
            });
          }
        );
      }

      async.series(pdfRequests, (err) => {
        if (err) {
          callback(err);
        } else {
          let archiveName = `caseInvestigationTemplates_${localizationHelper.now().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
          let archivePath = `${tmpDirName}/${archiveName}`;
          let zip = new AdmZip();

          zip.addLocalFolder(tmpDirName);
          zip.writeZip(archivePath);

          fs.readFile(archivePath, (err, data) => {
            if (err) {
              callback(apiError.getError('FILE_NOT_FOUND'));
            } else {
              tmpDir.removeCallback();
              app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
            }
          });
        }
      });
    });
  };

  /**
   * Backwards compatibility for find, filtered-count and per-classification count cases filters
   * @param context
   * @param modelInstance
   * @param next
   */
  Outbreak.helpers.findAndFilteredCountCasesBackCompat = function (context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);
    // get relationship query, if any
    const queryRelationship = _.get(filter, 'where.relationship');
    // if there is no relationship query, but there is an older version of the filter
    if (!queryRelationship && query.relationships) {
      // use that old version
      _.set(filter, 'where.relationship', query.relationships);
    }
    // get relationship query, if any
    const queryLabResults = _.get(filter, 'where.labResult');
    // if there is no relationship query, but there is an older version of the filter
    if (!queryLabResults && query.labResults) {
      // use that old version
      _.set(filter, 'where.labResult', query.labResults);
    }
    next();
  };

  /**
   * Backwards compatibility for find, filtered-count and per-classification count contacts filters
   * @param context
   * @param modelInstance
   * @param next
   */
  Outbreak.helpers.findAndFilteredCountContactsBackCompat = function (context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter, {people: 'case', relationships: 'relationship'});
    // get followUp query, if any
    const queryFollowUp = _.get(filter, 'where.followUp');
    // if there is no followUp query, but there is an older version of the filter
    if (!queryFollowUp && query.followUps) {
      // use that old version
      _.set(filter, 'where.followUp', query.followUps);
    }
    // get relationship query, if any
    const queryRelationship = _.get(filter, 'where.relationship');
    // if there is no relationship query, but there is an older version of the filter
    if (!queryRelationship && query.relationship) {
      // use that old version
      _.set(filter, 'where.relationship', query.relationship);
    }
    // get case query, if any
    const queryCase = _.get(filter, 'where.case');
    // if there is no case query, but there is an older version of the filter
    if (!queryCase && query.case) {
      // use that old version
      _.set(filter, 'where.case', query.case);
    }
    next();
  };

  /**
   * Backwards compatibility for find and filtered count lab results filters
   * @param context
   * @param modelInstance
   * @param next
   */
  Outbreak.helpers.findAndFilteredCountLabResultsBackCompat = function (context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);
    // get case query, if any
    const queryCase = _.get(filter, 'where.case');
    // if there is no case query, but there is an older version of the filter
    if (!queryCase && query.case) {
      // use that old version
      _.set(filter, 'where.case', query.case);
    }

    // be backwards compatible
    const personQuery = _.get(filter, 'where.person');
    if (!personQuery && query.person) {
      _.set(filter, 'where.person', query.person);
    }

    next();
  };

  /**
   * Backwards compatibility for find and filtered count follow-up filters
   * @param context
   * @param modelInstance
   * @param next
   */
  Outbreak.helpers.findAndFilteredCountFollowUpsBackCompat = function (context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);
    // get contact query, if any
    const queryContact = _.get(filter, 'where.contact');
    // if there is no contact query, but there is an older version of the filter
    if (!queryContact && query.contact) {
      // use that old version
      _.set(filter, 'where.contact', query.contact);
    }

    // finished
    next();
  };

  /**
   * Do not allow deletion of a active Outbreak
   * @param ctx
   * @param next
   */
  Outbreak.observe('before delete', function (ctx, next) {
    Outbreak.findById(ctx.currentInstance.id)
      .then(function (outbreak) {
        if (outbreak) {
          return app.models.User.count({
            activeOutbreakId: outbreak.id
          });
        } else {
          return 0;
        }
      })
      .then(function (userCount) {
        if (userCount) {
          return next(app.utils.apiError.getError('DELETE_ACTIVE_OUTBREAK', {id: ctx.currentInstance.id}, 422));
        }
        return next();
      })
      .catch(next);
  });

  /**
   * Outbreak after delete hook
   * Remove related language tokens
   * @param ctx
   * @param next
   */
  Outbreak.observe('after delete', (ctx, next) => {
    const outbreakId = ctx.instance.id;

    // don't wait for the hook actions to finish
    next();

    // remove related language tokens
    app.models.languageToken
      .destroyAll({
        token: {
          regexp: new RegExp(outbreakId, 'i')
        }
      })
      .catch(err => {
        app.logger.debug(`Failed to remove outbreak related language tokens. Error: ${err}`);
      });
  });

  /**
   * Create multiple contacts for case/event
   * @param outbreak Outbreak instance
   * @param modelName case/event
   * @param modelId caseId/eventId
   * @param data
   * @param options
   * @return {Promise<any>}
   */
  Outbreak.createPersonMultipleContacts = function (outbreak, modelName, modelId, data, options) {
    // inject platform identifier
    options.platform = Platform.BULK;

    // promisify the result
    return new Promise(function (resolve, reject) {
      // check if pairs of contacts + relationship were sent
      if (!data.length) {
        return reject(app.utils.apiError.getError('CONTACT_AND_RELATIONSHIP_REQUIRED'));
      }

      // initialize array of actions that will be executed in async mode
      let actions = [];

      // initialize array of failed/successful entries
      let failedEntries = [];
      let successfulEntries = [];

      // loop through the pairs and create contact + relationship; relationship needs to be created after the contact is created
      data.forEach(function (entry, index) {
        actions.push(function (asyncCallback) {
          // check for contact + relationship presence
          if (!entry.contact || !entry.relationship) {
            // don't try to create the contact or relationship
            // will not error the entire request if an entry fails; will return error for each failed entry
            // add entry in the failed list
            failedEntries.push({
              recordNo: index,
              error: app.utils.apiError.getError('CONTACT_AND_RELATIONSHIP_REQUIRED')
            });
            return asyncCallback();
          }

          // initialize pair result
          let result = {};

          // add outbreakId to contact and relationship
          entry.contact.outbreakId = outbreak.id;

          // create contact through loopback model functionality
          app.models.contact
            .create(entry.contact, options)
            .then(function (contact) {
              // add contact to result
              result.contact = contact;

              // add contact information into relationship data
              entry.relationship.persons = [{
                id: contact.id,
                type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                target: true
              }];

              // assume create case relationship
              let createPersonRelationship = outbreak.createCaseRelationship;
              // if model is event
              if (modelName === app.models.event.modelName) {
                // create event relationship
                createPersonRelationship = outbreak.createEventRelationship;
              }

              // create relationship; using the action and not the loopback model functionality as there are actions to be done before the actual create
              return new Promise(function (resolve, reject) {
                createPersonRelationship.call(outbreak, modelId, entry.relationship, options, function (err, relationship) {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(relationship);
                  }
                });
              });
            })
            .then(function (relationship) {
              // add relationship to the result
              result.relationship = relationship;

              // add pair to the success list
              successfulEntries.push(Object.assign({
                recordNo: index,
              }, result));

              asyncCallback();
            })
            .catch(function (err) {
              // pair add failed; add entry to the failed list
              failedEntries.push({
                recordNo: index,
                error: err
              });

              // will not error the entire request if an entry fails; will return error for each failed entry
              // check for what model the error was returned; if contact exists in result then the error is for relationship and we need to rollback contact
              // else the error is for contact and nothing else needs to be done
              if (result.contact) {
                // rollback contact
                result.contact
                  .destroy(options)
                  .then(function () {
                    app.logger.debug('Contact successfully rolled back');
                  })
                  .catch(function (rollbackError) {
                    app.logger.debug(`Failed to rollback contact. Error: ${rollbackError}`);
                  });
              } else {
                // nothing to do
              }

              asyncCallback();
            });
        });
      });

      // execute actions in sync because we need to generate a different visualID for each record
      async.series(actions, function (error) {
        if (error) {
          return reject(error);
        }

        if (!failedEntries.length) {
          // all entries added successfully
          resolve(successfulEntries);
        } else {
          reject(app.utils.apiError.getError('MULTIPLE_CONTACTS_CREATION_PARTIAL_SUCCESS', {
            failed: failedEntries,
            success: successfulEntries
          }));
        }
      });
    });
  };

  /**
   * Modify multiple persons
   * @param {Array} existingContacts - List of persons payloads
   * @param {string} personTYpe - String specifying whether the resources updated are case/contact/contactOfContact
   * @param {Object} options - Options from request
   * @return {Promise<any>}
   */
  Outbreak.modifyMultiplePersons = function (
    existingContacts,
    personType,
    options
  ) {
    // reference shortcuts
    const getError = app.utils.apiError.getError;
    const contactModel = personType === genericHelpers.PERSON_TYPE.CASE ?
      app.models.case :
      personType === genericHelpers.PERSON_TYPE.CONTACT_OF_CONTACT ?
        app.models.contactOfContact :
        app.models.contact;

    // promisify the result
    return new Promise((resolve, reject) => {
      // initialize array of actions that will be executed in async mode
      const actions = [];

      // initialize array of failed/successful entries
      const failedEntries = [];
      const successfulEntries = [];

      // nothing to do
      if (!existingContacts.length) {
        return resolve(successfulEntries);
      }

      // get contact ids and retrieve information about them
      const ids = [];
      existingContacts.forEach((contact) => {
        if (contact.id) {
          ids.push(contact.id);
        }
      });
      contactModel
        .find({
          where: {
            id: {
              inq: ids
            }
          }
        })
        .then((existingContactModel) => {
          const existingContactModelMap = {};
          existingContactModel.forEach((contact) => {
            existingContactModelMap[contact.id] = contact;
          });

          existingContacts.forEach((existingContact, index) => {
            actions.push((asyncCallback) => {
              // make sure a contact id is passed
              // otherwise we don't know which contact to update
              if (!existingContact.id) {
                failedEntries.push({
                  recordNo: index,
                  error: getError('CONTACT_ID_REQUIRED')
                });
                return asyncCallback();
              }

              // check if contact exists in database
              if (!existingContactModelMap[existingContact.id]) {
                failedEntries.push({
                  recordNo: index,
                  error: getError('MODEL_NOT_FOUND', {
                    model: contactModel.modelName,
                    id: existingContact.id
                  })
                });
                return asyncCallback();
              }

              // update contact attributes through loopback model functionality
              existingContactModelMap[existingContact.id]
                .updateAttributes(existingContact, options)
                .then((updatedContact) => {
                  // add it to success list
                  successfulEntries.push({
                    recordNo: index,
                    contact: updatedContact
                  });
                  return asyncCallback();
                })
                .catch((err) => {
                  // failed to update
                  failedEntries.push({
                    recordNo: index,
                    error: err
                  });
                  return asyncCallback();
                });
            });
          });

          // run the async actions
          async.series(actions, (err) => {
            if (err) {
              return reject(err);
            }

            // all entries updated successfully
            if (!failedEntries.length) {
              return resolve(successfulEntries);
            }

            // send back partial error
            return reject(getError('MULTIPLE_CONTACTS_UPDATE_PARTIAL_SUCCESS', {
              failed: failedEntries,
              success: successfulEntries
            }));
          });
        });
    });
  };

  /**
   * Create multiple contacts of contacts for a contact
   * @param outbreak
   * @param contactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.createContactMultipleContactsOfContacts = function (outbreak, contactId, data, options, callback) {
    // inject platform identifier
    options.platform = Platform.BULK;

    // check if pairs of contacts of contacts + relationship were sent
    if (!data.length) {
      return callback(app.utils.apiError.getError('CONTACT_OF_CONTACT_AND_RELATIONSHIP_REQUIRED'));
    }

    // initialize array of actions that will be executed in async mode
    let actions = [];

    // initialize array of failed/successful entries
    let failedEntries = [];
    let successfulEntries = [];

    // loop through the pairs and create contact of contact + relationship;
    // relationship needs to be created after the contact is created
    data.forEach(function (entry, index) {
      actions.push(function (asyncCallback) {
        // check for contact of contact + relationship presence
        if (!entry.contactOfContact || !entry.relationship) {
          // don't try to create the contact or relationship
          // will not error the entire request if an entry fails; will return error for each failed entry
          // add entry in the failed list
          failedEntries.push({
            recordNo: index,
            error: app.utils.apiError.getError('CONTACT_OF_CONTACT_AND_RELATIONSHIP_REQUIRED')
          });
          return asyncCallback();
        }

        // initialize pair result
        let result = {};

        // add outbreakId to contact of contact and relationship
        entry.contactOfContact.outbreakId = outbreak.id;

        // create contact through loopback model functionality
        app.models.contactOfContact
          .create(entry.contactOfContact, options)
          .then(function (contactOfContact) {
            // add contact to result
            result.contactOfContact = contactOfContact;

            // add contact information into relationship data
            entry.relationship.persons = [{
              id: contactId,
              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
              source: true
            }];

            // create relationship; using the action and not the loopback model functionality as there are actions to be done before the actual create
            return new Promise(function (resolve, reject) {
              outbreak.createContactOfContactRelationship.call(
                outbreak,
                contactOfContact.id,
                entry.relationship,
                options,
                function (err, relationship) {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(relationship);
                  }
                });
            });
          })
          .then(function (relationship) {
            // add relationship to the result
            result.relationship = relationship;

            // add pair to the success list
            successfulEntries.push(Object.assign({
              recordNo: index,
            }, result));

            asyncCallback();
          })
          .catch(function (err) {
            // pair add failed; add entry to the failed list
            failedEntries.push({
              recordNo: index,
              error: err
            });

            // will not error the entire request if an entry fails; will return error for each failed entry
            // check for what model the error was returned;
            // if contact exists in result then the error is for relationship and we need to rollback contact of contact
            // else the error is for contact and nothing else needs to be done
            if (result.contactOfContact) {
              // rollback contact of contact
              result.contactOfContact
                .destroy(options)
                .then(function () {
                  app.logger.debug('Contact of contact successfully rolled back');
                })
                .catch(function (rollbackError) {
                  app.logger.debug(`Failed to rollback contact. Error: ${rollbackError}`);
                });
            } else {
              // nothing to do
            }

            asyncCallback();
          });
      });
    });

    // execute actions in sync because we need to generate a different visualID for each record
    async.series(actions, function (error) {
      if (error) {
        return callback(error);
      }

      if (!failedEntries.length) {
        // all entries added successfully
        return callback(null, successfulEntries);
      } else {
        return callback(app.utils.apiError.getError('MULTIPLE_CONTACTS_OF_CONTACT_CREATION_PARTIAL_SUCCESS', {
          failed: failedEntries,
          success: successfulEntries
        }));
      }
    });
  };

  /**
   * Get independent transmission chains
   * @param {Object} outbreak - Outbreak instance
   * @param {Object} filter - also accepts 'active' boolean on the first level in 'where'. Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param {Object} options - options from request
   */
  Outbreak.helpers.getIndependentTransmissionChains = function (outbreak, filter, options) {
    // if contacts of contacts is disabled on the outbreak, do not include them in CoT
    const isContactsOfContactsActive = outbreak.isContactsOfContactsActive;

    // determine if we need to send to client just some specific fields
    if (
      filter.fields &&
      filter.fields.length > 0
    ) {
      // determine visible and format visible fields
      const edgeFields = {};
      const nodeFields = {};
      const edgesName = 'edges.';
      const nodesName = 'nodes.';
      filter.fields.forEach((field) => {
        // check if we have fields for our objects
        if (field.toLowerCase().startsWith(edgesName)) {
          // push to fields array
          edgeFields[field.substring(edgesName.length)] = 1;
        } else if (field.toLowerCase().startsWith(nodesName)) {
          // push to fields array
          nodeFields[field.substring(nodesName.length)] = 1;
        }
      });

      // Edges - push required fields
      Object.assign(
        edgeFields, {
          id: 1,
          contactDate: 1,
          persons: 1
        }
      );

      // Nodes - push required fields
      Object.assign(
        nodeFields, {
          id: 1,
          type: 1
        }
      );

      // set fields
      filter.fields = undefined;
      filter.retrieveFields = {
        edges: edgeFields,
        nodes: nodeFields
      };
    }

    // process filters
    return outbreak.preProcessTransmissionChainsFilter(filter, options)
      .then(function (processedFilter) {
        // use processed filters
        filter = Object.assign(
          processedFilter.filter, {
            retrieveFields: filter.retrieveFields
          }
        );
        const personIds = processedFilter.personIds;
        const endDate = processedFilter.endDate;
        const activeFilter = processedFilter.active;
        const includedPeopleFilter = processedFilter.includedPeopleFilter;
        const sizeFilter = processedFilter.size;
        const includeContacts = processedFilter.includeContacts;
        const noContactChains = processedFilter.noContactChains;
        const includeContactsOfContacts = processedFilter.includeContactsOfContacts;
        const geographicalRestrictionsQuery = processedFilter.geographicalRestrictionsQuery;

        // flag that indicates that contacts should be counted per chain
        const countContacts = processedFilter.countContacts;

        // end date is supported only one first level of where in transmission chains
        _.set(filter, 'where.endDate', endDate);

        return new Promise((resolve, reject) => {
          // get transmission chains
          app.models.relationship
            .getTransmissionChains(outbreak.id, outbreak.periodOfFollowup, filter, countContacts, noContactChains, geographicalRestrictionsQuery, function (error, transmissionChains) {
              if (error) {
                return reject(error);
              }

              // apply post filtering/processing
              transmissionChains = outbreak.postProcessTransmissionChains(
                {
                  active: activeFilter,
                  size: sizeFilter,
                  includedPeopleFilter: includedPeopleFilter
                },
                transmissionChains,
                {
                  includeContacts: includeContacts,
                  includeContactsOfContacts: isContactsOfContactsActive && includeContactsOfContacts && includeContacts
                }
              );

              // determine if isolated nodes should be included
              const shouldIncludeIsolatedNodes = (
                // there is no size filter
                (sizeFilter == null) &&
                // no included people filter
                !includedPeopleFilter
              );

              // initialize isolated nodes filter
              let isolatedNodesFilter;

              // build isolated nodes filter only if needed
              if (shouldIncludeIsolatedNodes) {
                // initialize isolated nodes filter
                isolatedNodesFilter = {
                  where: {
                    outbreakId: outbreak.id,
                    or: [
                      {
                        type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                        classification: {
                          nin: app.models.case.discardedCaseClassifications
                        }
                      },
                      {
                        type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                      }
                    ],
                    dateOfReporting: {
                      lte: endDate
                    }
                  }
                };

                // if there was a people filter
                // from preprocess function the personIds are already geographically restricted so no need to apply geographic restriction here
                if (personIds) {
                  // use it for isolated nodes as well
                  isolatedNodesFilter = app.utils.remote
                    .mergeFilters({
                      where: {
                        id: {
                          inq: personIds
                        }
                      }
                    }, isolatedNodesFilter);
                }
              }

              // depending on activeFilter we need to filter the transmissionChains
              if (typeof activeFilter !== 'undefined') {

                // update isolated nodes filter only if needed
                if (shouldIncludeIsolatedNodes) {

                  // update isolated nodes filter depending on active filter value
                  let followUpPeriod = outbreak.periodOfFollowup;
                  // get day of the start of the follow-up period starting from specified end date (by default, today)
                  let followUpStartDate = localizationHelper.getDateStartOfDay(endDate).subtract(followUpPeriod, 'days');

                  if (activeFilter) {
                    // get cases/events reported in the last followUpPeriod days
                    isolatedNodesFilter = app.utils.remote
                      .mergeFilters({
                        where: {
                          dateOfReporting: {
                            gte: localizationHelper.toMoment(followUpStartDate).toDate()
                          }
                        }
                      }, isolatedNodesFilter);
                  } else {
                    // get cases/events reported earlier than in the last followUpPeriod days
                    isolatedNodesFilter = app.utils.remote
                      .mergeFilters({
                        where: {
                          dateOfReporting: {
                            lt: localizationHelper.toMoment(followUpStartDate).toDate()
                          }
                        }
                      }, isolatedNodesFilter);
                  }
                }
              } else {
                // if isolated nodes don't need to be included, stop here
                if (!shouldIncludeIsolatedNodes) {
                  return resolve(transmissionChains);
                }
              }

              // look for isolated nodes, if needed
              if (shouldIncludeIsolatedNodes) {
                // update isolated nodes filter
                isolatedNodesFilter = app.utils.remote
                  .mergeFilters({
                    where: {
                      id: {
                        nin: Object.keys(transmissionChains.nodes)
                      }
                    }
                  }, isolatedNodesFilter);

                // get isolated nodes as well (nodes that were never part of a relationship)
                app.models.person
                  .rawFind(
                    app.utils.remote.convertLoopbackFilterToMongo(isolatedNodesFilter.where),
                    filter.retrieveFields && filter.retrieveFields.nodes ? {
                      projection: filter.retrieveFields.nodes
                    } : {}
                  )
                  .then(function (isolatedNodes) {
                    // add all the isolated nodes to the complete list of nodes
                    isolatedNodes.forEach(function (isolatedNode) {
                      transmissionChains.nodes[isolatedNode.id] = isolatedNode;
                    });

                    // send answer to client
                    resolve(transmissionChains);
                  })
                  .catch(reject);
              }
            });
        });
      })
      .then(result => {
        Object.keys(result.nodes).forEach((key) => {
          // transform Mongo geolocation to Loopback geolocation
          genericHelpers.covertAddressesGeoPointToLoopbackFormat(result.nodes[key]);
        });

        return result;
      });
  };

  /**
   * Export a daily person follow-up form for every person.
   */
  Outbreak.helpers.exportDailyPersonFollowUpList = function (
    outbreak,
    personType,
    res,
    groupBy,
    filter,
    options,
    callback
  ) {
    // define specific variables
    let personModel;
    let documentTitleToken;
    let fileName;
    if (personType === genericHelpers.PERSON_TYPE.CASE) {
      personModel = app.models.case;
      documentTitleToken = 'LNG_PAGE_TITLE_DAILY_CASES_LIST';
      fileName = 'Daily Case List.pdf';
    } else {
      // contact
      personModel = app.models.contact;
      documentTitleToken = 'LNG_PAGE_TITLE_DAILY_CONTACTS_LIST';
      fileName = 'Daily Contact List.pdf';
    }

    // generate report
    personModel
      .preFilterForOutbreak(outbreak, filter, options)
      .then(function (filter) {
        // get language id
        const languageId = options.remotingContext.req.authData.user.languageId;
        if (!['place', 'case'].includes(groupBy)) {
          groupBy = 'place';
        }

        /**
         * Flow control, make sure callback is not called multiple times
         * @param error
         * @param result
         */
        function cb(error, result) {
          // execute callback
          callback(error, result);
          // replace callback with no-op to prevent calling it multiple times
          callback = function noOp() {
          };
        }

        // load language dictionary
        app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
          // handle errors
          if (error) {
            return cb(error);
          }

          // start the builder
          const dailyFollowUpListBuilder = fork(`${__dirname}../../../components/workers/buildDailyContactList`,
            [], {
              execArgv: [],
              windowsHide: true
            }
          );

          /**
           * Event listener handler
           */
          function eventListener() {
            const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
            res.req.logger.error(JSON.stringify(error));
            cb(error);
          }

          // listen to exit events
          ['error', 'exit'].forEach(function (event) {
            dailyFollowUpListBuilder.on(event, eventListener);
          });

          // listen to builder messages
          dailyFollowUpListBuilder.on('message', function (args) {
            // first argument is an error
            if (args[0]) {
              // handle it
              cb(args[0]);
            }
            // if the message is a chunk
            if (args[1] && args[1].chunk) {
              // write it on the response
              res.write(Buffer.from(args[1].chunk.data));
            }
            // if the worker finished
            if (args[1] && args[1].end) {
              // end the response
              res.end();
              // process will be closed gracefully, remove listeners
              ['error', 'exit'].forEach(function (event) {
                dailyFollowUpListBuilder.removeListener(event, eventListener);
              });
              // stop the builder
              dailyFollowUpListBuilder.kill();
            }
          });

          // set appropriate headers
          res.set('Content-type', 'application/pdf');
          res.set('Content-disposition', `attachment;filename=${fileName}`);

          // keep a list of locations to resolve
          const locationsToResolve = [];
          // find persons for the found follow-ups
          // exclude entities with no valid followUp data
          const _filter = app.utils.remote
            .mergeFilters(filter, {
              where: {
                'followUp.startDate': {
                  $exists: true
                },
                'followUp.endDate': {
                  $exists: true
                }
              }
            });
          return personModel
            .rawFind(_filter.where, {
              projection: {
                followUp: 1,
                firstName: 1,
                middleName: 1,
                lastName: 1,
                gender: 1,
                age: 1,
                dateOfLastContact: 1,
                addresses: 1
              }
            })
            .then(function (contacts) {
              // map the contacts to easily reference them after
              const contactsMap = {};
              contacts.forEach(function (contact) {
                contactsMap[contact.id] = contact;
              });

              // find all follow ups for all contacts and group them by contact
              return app.models.followUp
                .rawFind({
                  personId: {
                    $in: Object.keys(contactsMap)
                  }
                })
                .then((followUps) => {
                  const groupedFollowups = _.groupBy(followUps, (f) => f.personId);

                  contacts = contacts.map((contact) => {
                    // sort by index and remove duplicates from the same day
                    let contactFollowUps = groupedFollowups[contact.id] || [];
                    contactFollowUps = _.uniqBy(contactFollowUps, 'index').sort((a, b) => a.index - b.index);
                    contact.followUps = contactFollowUps;
                    return contact;
                  });

                  // build groups (grouped by place/case)
                  const groups = {};
                  if (groupBy === 'place') {
                    // group contacts by place (location)
                    contacts.forEach((contact) => {
                      // assume unknown location
                      let locationId = 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';

                      // try to get location from the person
                      let currentAddress = app.models.person.getCurrentAddress(contact);

                      // if location was found
                      if (currentAddress) {
                        // use it
                        currentAddress.locationId = currentAddress.locationId ?
                          currentAddress.locationId :
                          'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';
                        locationId = currentAddress.locationId;
                      }

                      // init group (if not present)
                      if (!groups[locationId]) {
                        groups[locationId] = {
                          records: []
                        };
                      }

                      // to easily resolve it
                      contact.currentAddress = currentAddress || {
                        locationId: locationId
                      };

                      // add contact to the group
                      groups[locationId].records.push(contact);
                    });

                    // no need to return locations grouped by outbreak admin level locations
                    // that is how it was the old logic, which was removed after discussing with WHO in WGD-2000
                    return groups;
                  } else {
                    // group by case, first find relationships
                    return app.models.relationship
                      .rawFind({
                        outbreakId: outbreak.id,
                        'persons.id': {
                          inq: Object.keys(contactsMap)
                        }
                      }, {
                        projection: {
                          persons: 1
                        },
                        order: {contactDate: 1}
                      })
                      .then(function (relationships) {
                        // map contacts to cases
                        const contactToCaseMap = {};
                        relationships.forEach(function (relationship) {
                          let contactId;
                          let caseId;
                          // find contact and case
                          Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
                            if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                              contactId = person.id;
                            } else {
                              caseId = person.id;
                            }
                          });
                          // if found, add them to the map
                          if (contactId && caseId) {
                            contactToCaseMap[contactId] = caseId;
                          }
                        });
                        // find people (cases)
                        return app.models.person
                          .rawFind({
                            _id: {
                              inq: Object.values(contactToCaseMap)
                            },
                            outbreakId: outbreak.id,
                          }, {
                            projection: {
                              type: 1,
                              firstName: 1,
                              middleName: 1,
                              lastName: 1,
                              name: 1
                            }
                          })
                          .then(function (cases) {
                            // build people map to easily reference people by id
                            const casesMap = {};
                            cases.forEach(function (caseItem) {
                              casesMap[caseItem.id] = caseItem;
                            });

                            // go through all contacts
                            contacts.forEach((contact) => {
                              // init group if not already initiated
                              if (!groups[contactToCaseMap[contact.id]]) {
                                // get person information from the map
                                const person = casesMap[contactToCaseMap[contact.id]] || {};
                                // add group information
                                groups[contactToCaseMap[contact.id]] = {
                                  name: `${person.firstName || ''} ${person.middleName || ''} ${person.lastName || ''}`.trim(),
                                  records: []
                                };
                              }
                              // add follow-up to the group
                              groups[contactToCaseMap[contact.id]].records.push(contact);
                            });
                            return groups;
                          });
                      });
                  }
                })
                .then(function (groups) {
                  // if the grouping is done by place
                  if (groupBy === 'place') {
                    // add group ids to the list of locations that need to be resolved
                    locationsToResolve.push(...Object.keys(groups));
                  } else {
                    const locationsToRetrieve = {};
                    Object.keys(groups).forEach(function (groupId) {
                      groups[groupId].records.forEach(function (record) {
                        if (!record.currentAddress) {
                          record.currentAddress = app.models.person.getCurrentAddress(record);
                          if (
                            record.currentAddress &&
                            record.currentAddress.locationId &&
                            record.currentAddress.locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION'
                          ) {
                            locationsToRetrieve[record.currentAddress.locationId] = true;
                          }
                        }
                      });
                    });
                    locationsToResolve.push(...Object.keys(locationsToRetrieve));
                  }

                  // find locations
                  return app.models.location
                    .rawFind({
                      id: {
                        inq: locationsToResolve,
                      }
                    }, {
                      projection: {
                        name: 1
                      }
                    })
                    .then(function (locations) {
                      // build a map of locations to easily reference them by id
                      const locationsMap = {};
                      const data = {};
                      locations.forEach(function (location) {
                        locationsMap[location.id] = location;
                      });

                      // store unknown location translation
                      const unknownLocationTranslation = dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION');

                      // go through the groups
                      Object.keys(groups).forEach(function (groupId) {
                        // build data sets
                        data[groupId] = {
                          name: groups[groupId].name,
                          records: [],
                        };
                        // if the grouping is by place
                        if (groupBy === 'place') {
                          // and group id contains a location id
                          if (groupId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION') {
                            // resolve group name
                            data[groupId].name = _.get(locationsMap, `${groupId}.name`);
                          } else {
                            // otherwise add Unknown Location label
                            data[groupId].name = unknownLocationTranslation;
                          }
                        }

                        // go through all records
                        groups[groupId].records.forEach(function (record) {
                          if (!record.currentAddress) {
                            record.currentAddress = app.models.person.getCurrentAddress(record) || {
                              locationId: 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION'
                            };
                          }

                          // build record entry
                          const recordEntry = {
                            lastName: _.get(record, 'lastName', ''),
                            firstName: _.get(record, 'firstName', ''),
                            middleName: _.get(record, 'middleName', ''),
                            age: pdfUtils.displayAge(record, dictionary),
                            gender: dictionary.getTranslation(_.get(record, 'gender')),
                            location: record.currentAddress && record.currentAddress.locationId && record.currentAddress.locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION' && locationsMap[record.currentAddress.locationId] ?
                              locationsMap[record.currentAddress.locationId].name :
                              unknownLocationTranslation,
                            address: app.models.address.getHumanReadableAddress(record.currentAddress),
                            from: localizationHelper.toMoment(_.get(record, 'followUp.startDate')).format('YYYY-MM-DD'),
                            to: localizationHelper.toMoment(_.get(record, 'followUp.endDate')).format('YYYY-MM-DD'),
                            // needed for building tables
                            followUps: record.followUps,
                            followUp: record.followUp
                          };

                          // add record entry to dataset
                          data[groupId].records.push(recordEntry);
                        });
                      });
                      return data;
                    });
                })
                .then(function (groups) {
                  // translate follow ups status acronyms here
                  // to pass it to the worker
                  const followUpStatusAcronyms = app.models.followUp.statusAcronymMap;
                  const translatedFollowUpAcronyms = {};
                  const translatedFollowUpAcronymsAndIds = {};
                  for (let prop in followUpStatusAcronyms) {
                    const translatedProp = dictionary.getTranslation(prop);
                    const translatedValue = dictionary.getTranslation(followUpStatusAcronyms[prop]);
                    translatedFollowUpAcronyms[prop] = translatedValue;
                    translatedFollowUpAcronymsAndIds[translatedProp] = translatedValue;
                  }

                  // used to fit the table on one page
                  const standardHeaderSize = 40;

                  // build table headers
                  const headers = [
                    ...([{
                      id: 'firstName',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_FIRST_NAME'),
                      width: standardHeaderSize
                    }, {
                      id: 'lastName',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_LAST_NAME'),
                      width: standardHeaderSize
                    }, {
                      id: 'middleName',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_MIDDLE_NAME'),
                      width: standardHeaderSize + 10
                    }, {
                      id: 'age',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_AGE'),
                      width: standardHeaderSize
                    }, {
                      id: 'gender',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_GENDER'),
                      width: standardHeaderSize
                    }]),
                    ...(groupBy === 'case' ? [{
                      id: 'location',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_LOCATION'),
                      width: standardHeaderSize
                    }] : []),
                    ...([{
                      id: 'address',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_ADDRESS'),
                      width: standardHeaderSize
                    }, {
                      id: 'from',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_FROM'),
                      width: standardHeaderSize - 5
                    }, {
                      id: 'to',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TO'),
                      width: standardHeaderSize - 5
                    }])
                  ];


                  // group by title translation
                  const groupTitle = dictionary.getTranslation(groupBy === 'place' ?
                    'LNG_REPORT_DAILY_FOLLOW_UP_LIST_GROUP_TITLE_LOCATION' :
                    'LNG_REPORT_DAILY_FOLLOW_UP_LIST_GROUP_TITLE_CASE');

                  // total title translation
                  const totalTitle = dictionary.getTranslation('LNG_LIST_HEADER_TOTAL');

                  // start document title
                  const pdfTitle = dictionary.getTranslation(documentTitleToken);
                  const legendTitle = dictionary.getTranslation('LNG_FOLLOW_UP_STATUS_LEGEND');

                  // flag that indicates that start document props were added
                  let startDocumentAdded = false;

                  // process groups in batches
                  (function processInBatches(defaultHeaders, groups) {
                    // we process the first group always
                    const groupsKeys = Object.keys(groups);
                    if (!groupsKeys.length) {
                      // all records processed, inform the worker that is time to finish
                      return dailyFollowUpListBuilder.send({fn: 'finish', args: []});
                    }

                    const targetGroup = groups[groupsKeys[0]];
                    delete groups[groupsKeys[0]];

                    const listener = function (args) {
                      // first argument is an error
                      if (args[0]) {
                        // handle it
                        return cb(args[0]);
                      }
                      // if the worker is ready for the next batch
                      if (args[1] && args[1].readyForNextBatch) {
                        // remove current listener
                        dailyFollowUpListBuilder.removeListener('message', listener);
                        // send move to next step
                        processInBatches(headers, groups);
                      }
                    };

                    // listen to worker messages
                    dailyFollowUpListBuilder.on('message', listener);

                    // custom options to be sent over to the worker
                    const customOpts = {
                      groupTitle: groupTitle,
                      totalTitle: totalTitle
                    };

                    if (!startDocumentAdded) {
                      customOpts.startDocument = {
                        title: pdfTitle,
                        legend: {
                          title: legendTitle,
                          values: translatedFollowUpAcronymsAndIds
                        }
                      };
                    }

                    // build the group
                    dailyFollowUpListBuilder.send({
                      fn: 'sendData',
                      args: [
                        customOpts,
                        defaultHeaders,
                        targetGroup,
                        translatedFollowUpAcronyms
                      ]
                    });

                    // do not add start document opts on next call
                    startDocumentAdded = true;

                  })(headers, groups);
                });
            })
            .catch(cb);
        });
      });
  };

  /**
   * Export list of persons where each person has a page with follow up questionnaire and answers
   */
  Outbreak.helpers.exportDailyPersonFollowUpForm = function (
    outbreak,
    personType,
    response,
    filter,
    reqOptions,
    callback
  ) {
    // define specific variables
    let personModel;
    let followUpTemplate;
    let pageTitleToken;
    let contactTitleToken;
    let firstFollowUpDayToken;
    if (personType === genericHelpers.PERSON_TYPE.CASE) {
      personModel = app.models.case;
      followUpTemplate = outbreak.caseFollowUpTemplate;
      pageTitleToken = 'LNG_PAGE_LIST_CASES_EXPORT_DAILY_FOLLOW_UP_LIST_TITLE';
      contactTitleToken = 'LNG_PAGE_TITLE_CASE_DETAILS';
      firstFollowUpDayToken = 'LNG_CASE_FIELD_LABEL_FOLLOW_UP_START_DATE';
    } else {
      // contact
      personModel = app.models.contact;
      followUpTemplate = outbreak.contactFollowUpTemplate;
      pageTitleToken = 'LNG_PAGE_LIST_CONTACTS_EXPORT_DAILY_FOLLOW_UP_LIST_TITLE';
      contactTitleToken = 'LNG_PAGE_TITLE_CONTACT_DETAILS';
      firstFollowUpDayToken = 'LNG_CONTACT_FIELD_LABEL_FOLLOW_UP_START_DATE';
    }


    /**
     * Flow control, make sure callback is not called multiple times
     * @param error
     * @param result
     */
    const responseCallback = function (error, result) {
      // execute callback
      callback(error, result);
      // replace callback with no-op to prevent calling it multiple times
      callback = () => {
      };
    };

    // construct contacts query
    let contactQuery = app.utils.remote.mergeFilters({
      where: {
        outbreakId: outbreak.id
      }
    }, filter || {}).where;

    // add geographical restriction to filter if needed
    personModel
      .addGeographicalRestrictions(reqOptions.remotingContext, contactQuery)
      .then(updatedFilter => {
        // update contactQuery if needed
        updatedFilter && (contactQuery = updatedFilter);

        // get list of contacts based on the filter passed on request
        return personModel
          .rawFind(contactQuery, {
            projection: {
              id: 1,
              firstName: 1,
              middleName: 1,
              lastName: 1,
              gender: 1,
              age: 1,
              addresses: 1,
              followUp: 1
            }
          });
      })
      .then((contacts) => {
        // map contacts
        const contactsMap = {};
        (contacts || []).forEach((contact) => {
          contactsMap[contact.id] = contact;
        });

        // finished
        return contactsMap;
      })
      .then((contactsMap) => {
        // get all follow ups belonging to any of the contacts that matched the filter
        const followUpsFilter = app.utils.remote.convertLoopbackFilterToMongo(
          {
            $and: [
              // make sure we're only retrieving follow ups from the current outbreak
              // and for the contacts desired
              // retrieve only non-deleted records
              {
                outbreakId: outbreak.id,
                personId: {
                  $in: Object.keys(contactsMap)
                },
                deleted: false
              }
            ]
          });

        // run the aggregation against database
        return app.dataSources.mongoDb.connector
          .collection('followUp')
          .aggregate([
            {
              $match: followUpsFilter
            }, {
              $sort: {
                date: -1
              }
            },
            // group follow ups by person id
            // structure after grouping (_id -> personId, followUps -> list of follow ups)
            {
              $group: {
                _id: '$personId',
                followUps: {
                  $push: '$$ROOT'
                }
              }
            }
          ], {
            allowDiskUse: true
          })
          .toArray()
          .then((followUpData) => {
            // go through each group of follow-ups and assign it to the proper contact
            (followUpData || []).forEach((groupData) => {
              if (
                !contactsMap[groupData._id] ||
                !contactsMap[groupData._id].followUp ||
                !contactsMap[groupData._id].followUp.startDate ||
                !contactsMap[groupData._id].followUp.endDate
              ) {
                return;
              }

              // determine relevant follow-ups
              // those that are in our period of interest
              const firstFollowUpDay = localizationHelper.getDateStartOfDay(contactsMap[groupData._id].followUp.startDate);
              const lastFollowUpDay =  localizationHelper.getDateEndOfDay(contactsMap[groupData._id].followUp.endDate);
              contactsMap[groupData._id].followUps = _.filter(groupData.followUps, (followUpData) => {
                return followUpData.date &&
                  localizationHelper.toMoment(followUpData.date).isBetween(firstFollowUpDay, lastFollowUpDay, undefined, '[]');
              });
            });

            // finished
            return contactsMap;
          });
      })
      .then((contactsMap) => {
        // generate pdf
        return new Promise((resolve, reject) => {
          const languageId = reqOptions.remotingContext.req.authData.user.languageId;
          app.models.language.getLanguageDictionary(languageId, (err, dictionary) => {
            // error ?
            if (err) {
              return reject(err);
            }

            // build common labels (page title, comments title, contact details title)
            const commonLabels = {
              pageTitle: dictionary.getTranslation(pageTitleToken),
              contactTitle: dictionary.getTranslation(contactTitleToken),
              commentsTitle: dictionary.getTranslation('LNG_DATE_FIELD_LABEL_COMMENTS')
            };

            // build table data and contact details section properties
            const entries = [];
            _.each(contactsMap, (contactData) => {
              // table headers, first header has no name (it contains the questions)
              const tableHeaders = [
                {
                  id: 'description',
                  header: ''
                }
              ];

              // do we have followUp period ?
              let firstFollowUpDay;
              if (
                contactData.followUp &&
                contactData.followUp.startDate &&
                contactData.followUp.endDate
              ) {
                // get follow-up interval
                firstFollowUpDay = localizationHelper.getDateStartOfDay(contactData.followUp.startDate);
                const lastFollowUpDay = localizationHelper.getDateEndOfDay(contactData.followUp.endDate);

                // dates headers
                let dayIndex = 1;
                for (let date = firstFollowUpDay.clone(); date.isSameOrBefore(lastFollowUpDay); date.add(1, 'day')) {
                  tableHeaders.push({
                    id: date.format('YYYY-MM-DD'),
                    header: dayIndex
                  });
                  dayIndex++;
                }
              }

              // table data, each index is a row
              const tableData = [];

              // build the contact name, doing this to avoid unnecessary spaces, where a name is not defined
              const names = [
                contactData.firstName,
                contactData.middleName,
                contactData.lastName
              ];

              // final construct name structure that is displayed
              let displayedName = '';
              names.forEach((name) => {
                if (name) {
                  displayedName = displayedName + ' ' + pdfUtils.displayValue(name);
                }
              });

              // contact details section
              // will be displayed in the order they are defined
              const contactDetails = [
                {
                  label: dictionary.getTranslation('LNG_ENTITY_FIELD_LABEL_NAME'),
                  value: displayedName
                },
                {
                  label: dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_GENDER'),
                  value: dictionary.getTranslation(contactData.gender)
                },
                {
                  label: dictionary.getTranslation('LNG_ENTITY_FIELD_LABEL_AGE'),
                  value: pdfUtils.displayAge(contactData, dictionary)
                },
                {
                  label: dictionary.getTranslation(firstFollowUpDayToken),
                  value: firstFollowUpDay ?
                    localizationHelper.toMoment(firstFollowUpDay).format('YYYY-MM-DD') :
                    ''
                },
                {
                  label: dictionary.getTranslation('LNG_ENTITY_FIELD_LABEL_ADDRESS'),
                  value: app.models.address.getHumanReadableAddress(app.models.person.getCurrentAddress(contactData))
                },
                {
                  label: dictionary.getTranslation('LNG_ENTITY_FIELD_LABEL_PHONE_NUMBER'),
                  value: app.models.person.getCurrentAddress(contactData) ? app.models.person.getCurrentAddress(contactData).phoneNumber : ''
                }
              ];

              // add question to pdf form
              const addQuestionToForm = (question) => {
                // ignore irrelevant questions
                if (
                  [
                    'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD'
                  ].indexOf(question.answerType) >= 0
                ) {
                  return;
                }

                // add question texts as first row
                tableData.push({
                  description: dictionary.getTranslation(question.text)
                });

                // add answers for each follow up day
                (contactData.followUps || []).forEach((followUp) => {
                  // add follow-up only if there isn't already one on that date
                  // if there is, it means that that one is newer since follow-ups are sorted by date DESC and we don't need to set this one
                  const dateFormatted = localizationHelper.toMoment(followUp.date).format('YYYY-MM-DD');
                  if (!tableData[tableData.length - 1][dateFormatted]) {
                    // format questionnaire answers to old format so we can use the old functionality & also use the latest value
                    followUp.questionnaireAnswers = followUp.questionnaireAnswers || {};
                    followUp.questionnaireAnswers = genericHelpers.convertQuestionnaireAnswersToOldFormat(followUp.questionnaireAnswers);

                    // add cell data
                    tableData[tableData.length - 1][dateFormatted] = genericHelpers.translateQuestionAnswers(
                      question,
                      question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_DATE_TIME' ?
                        (followUp.questionnaireAnswers[question.variable] ? localizationHelper.toMoment(followUp.questionnaireAnswers[question.variable]).format('YYYY-MM-DD') : '') :
                        followUp.questionnaireAnswers[question.variable],
                      dictionary
                    );
                  }
                });

                // add additional questions
                (question.answers || []).forEach((answer) => {
                  (answer.additionalQuestions || []).forEach((childQuestion) => {
                    // add child question
                    addQuestionToForm(childQuestion);
                  });
                });
              };

              // add all questions as rows
              followUpTemplate.forEach((question) => {
                // add main question
                addQuestionToForm(question);
              });

              // add to list of pages
              entries.push({
                contactDetails: contactDetails,
                tableHeaders: tableHeaders,
                tableData: tableData
              });
            });

            // finished
            resolve({
              commonLabels: commonLabels,
              entries: entries
            });
          });
        });
      })
      .then((data) => {
        const pdfBuilder = fork(`${__dirname}../../../components/workers/buildDailyFollowUpForm`,
          [], {
            execArgv: [],
            windowsHide: true
          }
        );

        // error event listener, stop the whole request cycle
        const eventListener = function () {
          const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
          response.req.logger.error(JSON.stringify(error));
          return responseCallback(error);
        };

        // listen to exit/error events
        ['error', 'exit'].forEach((event) => {
          pdfBuilder.on(event, eventListener);
        });

        // listen to builder messages
        pdfBuilder.on('message', (args) => {
          // first argument is an error
          if (args[0]) {
            return responseCallback(args[0]);
          }
          // if the message is a chunk
          if (args[1] && args[1].chunk) {
            // write it on the response
            response.write(Buffer.from(args[1].chunk.data));
          }
          // if the worker finished, end the response as well
          if (args[1] && args[1].end) {
            // end the response
            response.end();

            // process will be closed gracefully, remove listeners
            ['error', 'exit'].forEach(function (event) {
              pdfBuilder.removeListener(event, eventListener);
            });

            // kill the builder process
            pdfBuilder.kill();
          }
        });

        // set headers related to files download
        response.set('Content-type', 'application/pdf');
        response.set('Content-disposition', `attachment;filename=${data.commonLabels.pageTitle}.pdf`);

        // process contacts in batches
        (function nextBatch(commonLabels, data) {
          // get current set size
          let currentSetSize = data.length;
          // no records left to be processed
          if (currentSetSize === 0) {
            // all records processed, inform the worker that is time to finish
            return pdfBuilder.send({fn: 'finish', args: []});
          } else if (currentSetSize > 100) {
            // too many records left, limit batch size to 100
            currentSetSize = 100;
          }
          // build a subset of data
          const dataSubset = data.splice(0, currentSetSize);

          // worker communicates via messages, listen to them
          const messageListener = function (args) {
            // first argument is an error
            if (args[0]) {
              return responseCallback(args[0]);
            }
            // if the worker is ready for the next batch
            if (args[1] && args[1].readyForNextBatch) {
              // remove current listener
              pdfBuilder.removeListener('message', messageListener);
              // send move to next step
              nextBatch(commonLabels, data);
            }
          };

          // listen to worker messages
          pdfBuilder.on('message', messageListener);

          // build pdf
          pdfBuilder.send({
            fn: 'sendData',
            args: [commonLabels, dataSubset, !data.length]
          });
        })(data.commonLabels, data.entries);
      })
      .catch(responseCallback);
  };

  /**
   * Returns a pdf list, containing the outbreak's cases/contacts, distributed by location and follow-up status
   */
  Outbreak.helpers.downloadPersonTracingPerLocationLevelReport = function (
    outbreak,
    personType,
    filter,
    options,
    callback
  ) {

    // define specific variables
    let personModelName;
    let reportTitle;
    if (personType === genericHelpers.PERSON_TYPE.CASE) {
      personModelName = 'case';
      reportTitle = 'Case';
    } else {
      // contact
      personModelName = 'contact';
      reportTitle = 'Contact';
    }

    // language
    const languageId = options.remotingContext.req.authData.user.languageId;

    // set default filter values
    filter = filter || {};
    filter.where = filter.where || {};

    // set default dateOfFollowUp
    if (
      !filter.dateOfFollowUp &&
      !filter.where.dateOfFollowUp
    ) {
      filter.dateOfFollowUp = localizationHelper.now().toDate();
    }

    // got dateOfFollowUp in where as it should be and not under filter ?
    if (filter.where.dateOfFollowUp) {
      filter.dateOfFollowUp = filter.where.dateOfFollowUp;
      delete filter.where.dateOfFollowUp;
    }

    // Get the date of the selected day for report to add to the pdf title (by default, current day)
    let selectedDayForReport = localizationHelper.toMoment(filter.dateOfFollowUp).format('ll');

    // Get the dictionary so we can translate the case classifications and other necessary fields
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      app.models.person.getPeoplePerLocation(personModelName, true, filter, outbreak, options)
        .then((result) => {
          // Initiate the headers for the entity tracing per location pdf list
          let headers = [
            {
              id: 'location',
              header: dictionary.getTranslation(outbreak.reportingGeographicalLevelId)
            },
            {
              id: 'underFollowUp',
              header: dictionary.getTranslation('LNG_LIST_HEADER_UNDER_FOLLOWUP')
            },
            {
              id: 'seenOnDay',
              header: dictionary.getTranslation('LNG_LIST_HEADER_SEEN_ON_DAY')
            },
            {
              id: 'coverage',
              header: '%'
            },
            {
              id: 'registered',
              header: dictionary.getTranslation('LNG_LIST_HEADER_REGISTERED')
            },
            {
              id: 'released',
              header: dictionary.getTranslation('LNG_LIST_HEADER_RELEASED')
            },
            {
              id: 'expectedRelease',
              header: dictionary.getTranslation('LNG_LIST_HEADER_EXPECTED_RELEASE')
            }
          ];

          let data = [];
          result.peopleDistribution.forEach((dataObj) => {
            // Define the base form of the data for one row of the pdf list
            // Keep the values as strings so that 0 actually gets displayed in the table
            let row = {
              location: dataObj.location.name,
              underFollowUp: '0',
              seenOnDay: '0',
              coverage: '0',
              registered: '0',
              released: '0',
              expectedRelease: dataObj.people.length && dataObj.people[0].followUp ? localizationHelper.toMoment(dataObj.people[0].followUp.endDate).format('ll') : '-'
            };

            // Update the row's values according to each entity's details
            dataObj.people.forEach((item) => {
              row.registered = +row.registered + 1;

              // Any status other than under follow-up will make the entity be considered as released.
              if (item.followUp && item.followUp.status === 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP') {
                row.underFollowUp = +row.underFollowUp + 1;

                // The contact can be seen only if he is under follow
                if (item.followUps.length) {
                  let completedFollowUp = _.find(item.followUps, function (followUp) {
                    return ['LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK',
                      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK'].includes(followUp.statusId);
                  });
                  if (completedFollowUp) {
                    row.seenOnDay = +row.seenOnDay + 1;
                  }

                  // What percentage of the contacts under followUp have been seen on the specified date.
                  row.coverage = +row.seenOnDay / +row.underFollowUp * 100;
                }

              } else {
                row.released = +row.released + 1;
              }
            });
            data.push(row);
          });

          // Create the pdf list file
          return app.utils.helpers.exportListFile(headers, data, 'pdf', `${reportTitle} tracing ${selectedDayForReport}`);
        })
        .then(function (file) {
          // and offer it for download
          app.utils.remote.helpers.offerFileToDownload(file.data, file.mimeType, `${reportTitle} tracing report.${file.extension}`, callback);
        })
        .catch((error) => {
          callback(error);
        });
    });
  };

  /**
   * Count persons that are on the follow up list when generating
   * Also custom filtered
   */
  Outbreak.helpers.filteredCountPersonsOnFollowUpList = function (
    outbreak,
    personType,
    filter = {},
    options,
    callback
  ) {
    // define specific variables
    let personModel;
    const isCaseType = personType === genericHelpers.PERSON_TYPE.CASE;
    if (isCaseType) {
      personModel = app.models.case;
    } else {
      // contact
      personModel = app.models.contact;
    }

    // defensive checks
    filter.where = filter.where || {};
    let startDate = localizationHelper.getDateStartOfDay().toDate();
    let endDate = localizationHelper.getDateEndOfDay().toDate();
    if (filter.where.startDate) {
      startDate = localizationHelper.getDateStartOfDay(filter.where.startDate).toDate();
      delete filter.where.startDate;
    }
    if (filter.where.endDate) {
      endDate = localizationHelper.getDateEndOfDay(filter.where.endDate).toDate();
      delete filter.where.endDate;
    }

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (
      classification &&
      !isCaseType
    ) {
      // for contacts, the filtering by classification is performed later
      delete filter.where.classification;
    }

    // merge filter props from request with the built-in filter
    // there is no way to reuse the filter from follow up generation filter
    // this is slightly modified to accustom the needs and also inconclusive/valid persons are merged in one op here
    const mergedFilter = app.utils.remote.mergeFilters({
      where: {
        outbreakId: outbreak.id,
        followUp: {
          $ne: null
        },
        // only persons that are under follow up
        'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP',
        $or: [
          {
            // eligible for follow ups
            $and: [
              {
                $or: [
                  {
                    // follow up period is inside person's follow up period
                    $and: [
                      {
                        'followUp.startDate': {
                          $lte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: endDate
                        }
                      }
                    ]
                  },
                  {
                    // period starts before person's start date but ends before person's end date
                    $and: [
                      {
                        'followUp.startDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.startDate': {
                          $lte: endDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: endDate
                        }
                      }
                    ]
                  },
                  {
                    // period starts before person's end date and after person's start date
                    // but stops after person's end date
                    $and: [
                      {
                        'followUp.startDate': {
                          $lte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $lte: endDate
                        }
                      }
                    ]
                  },
                  {
                    // person's period is inside follow up period
                    $and: [
                      {
                        'followUp.startDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $lte: endDate
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }, filter);

    // add geographical restriction to filter if needed
    let promise = personModel
      .addGeographicalRestrictions(options.remotingContext, mergedFilter.where)
      .then(updatedFilter => {
        updatedFilter && (mergedFilter.where = updatedFilter);
      });

    // do we need to filter contacts by case classification ?
    if (
      classification &&
      personType === genericHelpers.PERSON_TYPE.CONTACT
    ) {
      // retrieve cases
      promise = promise
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: outbreak.id,
              deleted: false,
              classification: app.utils.remote.convertLoopbackFilterToMongo(classification)
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: outbreak.id,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          mergedFilter.where = {
            $and: [
              mergedFilter.where, {
                _id: {
                  $in: contactIds
                }
              }
            ]
          };
        });
    }

    // get cases that are available for follow up generation
    promise
      .then(() => {
        return personModel
          .rawFind(mergedFilter.where, {projection: {'_id': 1}})
          .then((ids) => callback(null, ids.length, ids.map(obj => obj.id)))
          .catch(callback);
      });
  };

  /**
   * Count the persons that are lost to follow-up
   */
  Outbreak.helpers.countPersonsLostToFollowup = function (
    outbreak,
    personType,
    filter,
    options
  ) {
    // define specific variables
    let personModel;
    let contactsLostToFollowupCountProperty;
    let contactIDsProperty;
    const isCaseType = personType === genericHelpers.PERSON_TYPE.CASE;
    if (isCaseType) {
      personModel = app.models.case;
      contactsLostToFollowupCountProperty = 'casesLostToFollowupCount';
      contactIDsProperty = 'caseIDs';
    } else {
      // contact
      personModel = app.models.contact;
      contactsLostToFollowupCountProperty = 'contactsLostToFollowupCount';
      contactIDsProperty = 'contactIDs';
    }

    // get outbreakId
    let outbreakId = outbreak.id;

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (
      classification &&
      !isCaseType
    ) {
      delete filter.where.classification;
    }

    // create filter as we need to use it also after the relationships are found
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          followUp: {
            neq: null
          },
          'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP'
        }
      }, filter || {});

    // do we need to filter contacts by case classification ?
    let promise = Promise.resolve();
    if (
      classification &&
      !isCaseType
    ) {
      // retrieve cases
      promise = promise
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: outbreakId,
              deleted: false,
              classification: app.utils.remote.convertLoopbackFilterToMongo(classification)
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: outbreakId,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          _filter.where = {
            $and: [
              _filter.where, {
                _id: {
                  $in: contactIds
                }
              }
            ]
          };
        });
    }

    // get contacts that are available for follow up generation
    return promise
      .then(() => {
        // add geographical restriction to filter if needed
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, _filter.where)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (_filter.where = updatedFilter);

            // get all relationships between events and contacts, where the persons were created sooner than 'noDaysNewContacts' ago
            return personModel
              .rawFind(_filter.where)
              .then(function (contacts) {
                return {
                  [contactsLostToFollowupCountProperty]: contacts.length,
                  [contactIDsProperty]: contacts.map((contact) => contact.id)
                };
              });
          });
      });
  };

  /**
   * Count the persons not seen in the past X days
   * @param filter Besides the default filter properties this request also accepts 'noDaysNotSeen': number on the first level in 'where'
   */
  Outbreak.helpers.countPersonsNotSeenInXDays = function (
    outbreak,
    personType,
    filter,
    options,
    callback
  ) {
    // define specific variables
    let personModel;
    let contactsCountProperty;
    let contactIDsProperty;
    const isCaseType = personType === genericHelpers.PERSON_TYPE.CASE;
    if (isCaseType) {
      personModel = app.models.case;
      contactsCountProperty = 'casesCount';
      contactIDsProperty = 'caseIDs';
    } else {
      // contact
      personModel = app.models.contact;
      contactsCountProperty = 'contactsCount';
      contactIDsProperty = 'contactIDs';
    }

    filter = filter || {};
    // initialize noDaysNotSeen filter
    let noDaysNotSeen;
    // check if the noDaysNotSeen filter was sent; accepting it only on the first level
    noDaysNotSeen = _.get(filter, 'where.noDaysNotSeen');
    if (typeof noDaysNotSeen !== 'undefined') {
      // noDaysNotSeen was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNotSeen;
    } else {
      // get the outbreak noDaysNotSeen as the default noDaysNotSeen value
      noDaysNotSeen = outbreak.noDaysNotSeen;
    }

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (classification) {
      delete filter.where.classification;
    }

    // get outbreakId
    let outbreakId = outbreak.id;

    // get date from noDaysNotSeen days ago
    let xDaysAgo = localizationHelper.getDateStartOfDay().subtract(noDaysNotSeen, 'day');

    // get contact query
    let contactQuery = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter).contact;

    // // make sure that only specified person types are fetched
    // contactQuery = contactQuery || {};
    // contactQuery.type = personType;

    // by default, find contacts does not perform any task
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (classification) {
      if (isCaseType) {
        contactQuery.classification = app.utils.remote.convertLoopbackFilterToMongo(classification);
      } else {
        // retrieve cases
        findContacts = findContacts
          .then(() => {
            return app.models.case
              .rawFind({
                outbreakId: outbreakId,
                deleted: false,
                classification: app.utils.remote.convertLoopbackFilterToMongo(classification)
              }, {projection: {'_id': 1}});
          })
          .then((caseData) => {
            // no case data, so there is no need to retrieve relationships
            if (_.isEmpty(caseData)) {
              return [];
            }

            // retrieve list of cases for which we need to retrieve contacts relationships
            const caseIds = caseData.map((caseModel) => caseModel.id);

            // retrieve relationships
            return app.models.relationship
              .rawFind({
                outbreakId: outbreakId,
                deleted: false,
                $or: [
                  {
                    'persons.0.source': true,
                    'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                    'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                    'persons.0.id': {
                      $in: caseIds
                    }
                  }, {
                    'persons.1.source': true,
                    'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                    'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                    'persons.1.id': {
                      $in: caseIds
                    }
                  }
                ]
              }, {projection: {persons: 1}});
          })
          .then((relationshipData) => {
            // determine contacts which can be retrieved
            let contactIds = {};
            (relationshipData || []).forEach((contact) => {
              const id = contact.persons[0].target ?
                contact.persons[0].id :
                contact.persons[1].id;
              contactIds[id] = true;
            });
            contactIds = Object.keys(contactIds);

            // filter contacts
            if (contactQuery) {
              contactQuery = {
                and: [
                  contactQuery, {
                    id: {
                      inq: contactIds
                    }
                  }
                ]
              };
            } else {
              contactQuery = {
                id: {
                  inq: contactIds
                }
              };
            }
          });
      }
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // add geographical restriction to filter if needed
        return personModel
          .addGeographicalRestrictions(options.remotingContext, contactQuery)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (contactQuery = updatedFilter);

            // no contact query
            if (!contactQuery) {
              return;
            }

            // if a contact query was specified
            return personModel
              .rawFind({
                and: [
                  {outbreakId: outbreakId},
                  contactQuery
                ]
              }, {projection: {'_id': 1}})
              .then(function (contacts) {
                // return a list of contact ids
                return contacts.map(contact => contact.id);
              });
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        let followUpQuery = {
          where: {
            and: [
              {
                outbreakId: outbreakId
              },
              {
                // get follow-ups that were scheduled in the past noDaysNotSeen days
                date: {
                  between: [xDaysAgo, localizationHelper.getDateEndOfDay()]
                }
              },
              // restrict the list of follow-ups by person type
              {
                'contact.type': personType
              },
              app.models.followUp.notSeenFilter
            ]
          },
          // order by date as we need to check the follow-ups from the oldest to the most new
          order: {
            date: 1
          }
        };

        // if a list of contact ids was specified
        if (contactIds) {
          // restrict list of follow-ups to the list fo contact ids
          followUpQuery.where.and.push({
            personId: {
              inq: contactIds
            }
          });
        }

        // get follow-ups
        return app.models.followUp.findAggregate(
          app.utils.remote.mergeFilters(followUpQuery, filter || {})
        )
          .then(followUps => {
            const resultContactsList = [];
            // group follow ups per contact
            const groupedByContact = _.groupBy(followUps, (f) => f.personId);
            for (let contactId in groupedByContact) {
              // keep one follow up per day
              const contactFollowUps = [...new Set(groupedByContact[contactId].map((f) => f.index))];
              if (contactFollowUps.length === noDaysNotSeen) {
                resultContactsList.push(contactId);
              }
            }
            // send response
            return callback(null, {
              [contactsCountProperty]: resultContactsList.length,
              [contactIDsProperty]: resultContactsList
            });
          });
      })
      .catch(callback);
  };

  /**
   * Count the person that have followups scheduled and the persons with successful followups
   */
  Outbreak.helpers.countPersonsWithSuccessfulFollowups = function (
    outbreak,
    personType,
    filter,
    options,
    callback
  ) {
    // define specific variables
    let personModel;
    let totalContactsWithFollowupsCountProperty;
    let contactsWithSuccessfulFollowupsCountProperty;
    let contactsProperty;
    let missedContactsIDsProperty;
    let followedUpContactsIDsProperty;
    const isCaseType = personType === genericHelpers.PERSON_TYPE.CASE;
    if (isCaseType) {
      personModel = app.models.case;
      totalContactsWithFollowupsCountProperty = 'totalCasesWithFollowupsCount';
      contactsWithSuccessfulFollowupsCountProperty = 'casesWithSuccessfulFollowupsCount';
      contactsProperty = 'cases';
      missedContactsIDsProperty = 'missedCasesIDs';
      followedUpContactsIDsProperty = 'followedUpCasesIDs';
    } else {
      // contact
      personModel = app.models.contact;
      totalContactsWithFollowupsCountProperty = 'totalContactsWithFollowupsCount';
      contactsWithSuccessfulFollowupsCountProperty = 'contactsWithSuccessfulFollowupsCount';
      contactsProperty = 'contacts';
      missedContactsIDsProperty = 'missedContactsIDs';
      followedUpContactsIDsProperty = 'followedUpContactsIDs';
    }

    filter = filter || {};
    const FollowUp = app.models.followUp;

    // initialize result
    let result = {
      [totalContactsWithFollowupsCountProperty]: 0,
      [contactsWithSuccessfulFollowupsCountProperty]: 0,
      teams: [],
      [contactsProperty]: []
    };

    // get outbreakId
    let outbreakId = outbreak.id;

    // retrieve relations queries
    const relationsQueries = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);

    // get contact query, if any
    let contactQuery = relationsQueries.contact;

    // get case query, if any
    const caseQuery = relationsQueries.case;

    // by default, find contacts does not perform any task
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (caseQuery) {
      // retrieve cases
      findContacts = findContacts
        .then(() => {
          return app.models.case
            .rawFind({
              and: [
                caseQuery, {
                  outbreakId: outbreakId,
                  deleted: false
                }
              ]
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: outbreakId,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          if (contactQuery) {
            contactQuery = {
              and: [
                contactQuery, {
                  id: {
                    inq: contactIds
                  }
                }
              ]
            };
          } else {
            contactQuery = {
              id: {
                inq: contactIds
              }
            };
          }
        });
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // add geographical restriction to filter if needed
        return app.models.person
          .addGeographicalRestrictions(options.remotingContext, contactQuery)
          .then(updatedFilter => {
            // update where if needed
            updatedFilter && (contactQuery = updatedFilter);

            // no contact query
            if (!contactQuery) {
              return;
            }

            // if a contact query was specified
            return personModel
              .rawFind({and: [contactQuery, {outbreakId: outbreakId}]}, {projection: {_id: 1}})
              .then(function (contacts) {
                // return a list of contact ids
                return contacts.map(contact => contact.id);
              });
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        // build follow-up filter
        let _filter = {
          where: {
            outbreakId: outbreakId,
            // restrict the list of follow-ups by person type
            'contact.type': personType
          }
        };

        // if contact ids were specified
        if (contactIds) {
          // restrict follow-up query to those ids
          _filter.where.personId = {
            inq: contactIds
          };
        }

        // get all the followups for the filtered period
        return app.models.followUp.findAggregate(app.utils.remote
          .mergeFilters(_filter, filter || {}))
          .then(function (followups) {
            // filter by relation properties
            followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

            // initialize teams map and contacts map as the request needs to count contacts
            let teamsMap = {};
            let contactsMap = {};
            // initialize helper contacts to team map
            let contactsTeamMap = {};

            followups.forEach(function (followup) {
              // get contactId
              let contactId = followup.personId;
              // get teamId; there might be no team id, set null
              let teamId = followup.teamId || null;

              // check if a followup for the same contact was already parsed
              if (contactsTeamMap[contactId]) {
                // check if there was another followup for the same team
                // if so check for the performed flag;
                // if the previous followup was performed there is no need to update any team contacts counter;
                // total and successful counters were already updated
                if (contactsTeamMap[contactId].teams[teamId]) {
                  // new follow-up for the contact from the same team is performed; update flag and increase successful counter
                  if (!contactsTeamMap[contactId].teams[teamId].performed && FollowUp.isPerformed(followup) === true) {
                    // update performed flag
                    contactsTeamMap[contactId].teams[teamId].performed = true;
                    // increase successful counter for team
                    teamsMap[teamId][contactsWithSuccessfulFollowupsCountProperty]++;
                    // update followedUpContactsIDs/missedContactsIDs lists
                    teamsMap[teamId][followedUpContactsIDsProperty].push(contactId);
                    teamsMap[teamId][missedContactsIDsProperty].splice(teamsMap[teamId][missedContactsIDsProperty].indexOf(contactId), 1);
                  }
                } else {
                  // new teamId
                  // cache followup performed information for contact in team
                  contactsTeamMap[contactId].teams[teamId] = {
                    performed: FollowUp.isPerformed(followup)
                  };

                  // initialize team entry if doesn't already exist
                  if (!teamsMap[teamId]) {
                    teamsMap[teamId] = {
                      id: teamId,
                      [totalContactsWithFollowupsCountProperty]: 0,
                      [contactsWithSuccessfulFollowupsCountProperty]: 0,
                      [followedUpContactsIDsProperty]: [],
                      [missedContactsIDsProperty]: []
                    };
                  }

                  // increase team counters
                  teamsMap[teamId][totalContactsWithFollowupsCountProperty]++;
                  if (FollowUp.isPerformed(followup)) {
                    teamsMap[teamId][contactsWithSuccessfulFollowupsCountProperty]++;
                    // keep contactId in the followedUpContactsIDs list
                    teamsMap[teamId][followedUpContactsIDsProperty].push(contactId);
                  } else {
                    // keep contactId in the missedContactsIDs list
                    teamsMap[teamId][missedContactsIDsProperty].push(contactId);
                  }
                }
              } else {
                // first followup for the contact; add it in the contactsMap
                contactsMap[contactId] = {
                  id: contactId,
                  totalFollowupsCount: 0,
                  successfulFollowupsCount: 0
                };

                // cache followup performed information for contact in team and overall
                contactsTeamMap[contactId] = {
                  teams: {
                    [teamId]: {
                      performed: FollowUp.isPerformed(followup)
                    }
                  },
                  performed: FollowUp.isPerformed(followup),
                };

                // increase overall counters
                result[totalContactsWithFollowupsCountProperty]++;

                // initialize team entry if doesn't already exist
                if (!teamsMap[teamId]) {
                  teamsMap[teamId] = {
                    id: teamId,
                    [totalContactsWithFollowupsCountProperty]: 0,
                    [contactsWithSuccessfulFollowupsCountProperty]: 0,
                    [followedUpContactsIDsProperty]: [],
                    [missedContactsIDsProperty]: []
                  };
                }

                // increase team counters
                teamsMap[teamId][totalContactsWithFollowupsCountProperty]++;
                if (FollowUp.isPerformed(followup)) {
                  teamsMap[teamId][contactsWithSuccessfulFollowupsCountProperty]++;
                  // keep contactId in the followedUpContactsIDs list
                  teamsMap[teamId][followedUpContactsIDsProperty].push(contactId);
                  // increase total successful total counter
                  result[contactsWithSuccessfulFollowupsCountProperty]++;
                } else {
                  // keep contactId in the missedContactsIDs list
                  teamsMap[teamId][missedContactsIDsProperty].push(contactId);
                }
              }

              // update total follow-ups counter for contact
              contactsMap[contactId].totalFollowupsCount++;
              if (FollowUp.isPerformed(followup)) {
                // update counter for contact successful follow-ups
                contactsMap[contactId].successfulFollowupsCount++;

                // check if contact didn't have a successful followup and the current one was performed
                // as specified above for teams this is the only case where updates are needed
                if (!contactsTeamMap[contactId].performed) {
                  // update overall performed flag
                  contactsTeamMap[contactId].performed = true;
                  // increase total successful total counter
                  result[contactsWithSuccessfulFollowupsCountProperty]++;
                }
              }
            });

            // update results; sending array with teams and contacts information
            result.teams = Object.values(teamsMap);
            result[contactsProperty] = Object.values(contactsMap);

            // send response
            callback(null, result);
          });
      })
      .catch(callback);
  };
};
