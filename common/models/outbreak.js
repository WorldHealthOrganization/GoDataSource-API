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

// used to manipulate dates
const moment = require('moment');

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
    frequencyOfFollowUpPerDay: 'LNG_OUTBREAK_FIELD_LABEL_FOLLOWUP_FRECQUENCY_PER_DAY',
    noDaysAmongContacts: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_AMONG_KNOWN_CONTACTS',
    noDaysInChains: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_IN_KNOWN_TRANSMISSION_CHAINS',
    noDaysNotSeen: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_NOT_SEEN',
    noLessContacts: 'LNG_OUTBREAK_FIELD_LABEL_LESS_THAN_X_CONTACTS',
    noDaysNewContacts: 'LNG_OUTBREAK_FIELD_LABEL_DAYS_NEW_CONTACT',
    'fieldsToDisplayNode[]': 'LNG_OUTBREAK_FIELD_LABEL_FIELDS_TO_DISPLAY_NODE',
    caseInvestigationTemplate: 'LNG_OUTBREAK_FIELD_LABEL_CASE_INVESTIGATION_TEMPLATE',
    contactFollowUpTemplate: 'LNG_OUTBREAK_FIELD_LABEL_CONTACT_FOLLOWUP_TEMPLATE',
    labResultsTemplate: 'LNG_OUTBREAK_FIELD_LABEL_LAB_RESULTS_TEMPLATE',
    caseIdMask: 'LNG_OUTBREAK_FIELD_LABEL_CASE_ID_MASK',
    contactIdMask: 'LNG_OUTBREAK_FIELD_LABEL_CONTACT_ID_MASK',
    'arcGisServers': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVERS',
    'arcGisServers[].name': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_NAME',
    'arcGisServers[].url': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_URL'
  });

  Outbreak.referenceDataFieldsToCategoryMap = {
    disease: 'LNG_REFERENCE_DATA_CATEGORY_DISEASE',
    'countries[].id': 'LNG_REFERENCE_DATA_CATEGORY_COUNTRY'
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
  Outbreak.setMaxListeners(70);

  // The permissions that influence an user's ability to see a person's data
  Outbreak.personReadPermissions = [
    'read_case',
    'read_contact'
  ];

  // The fields that will be displayed when a user receives a person's data even though he does not
  // have permission to see it (ex. reports, chains of transmission, etc)
  Outbreak.noPersonReadPermissionFields = [
    'id',
    'type'
  ];

  /**
   * Checks whether the given follow up model is generated
   * Checks that update/create dates are on the same
   * Checks that it is not performed or lost
   * @param model
   * @returns {boolean}
   */
  Outbreak.helpers.isNewGeneratedFollowup = function (model) {
    return moment(model.createdAt).isSame(moment(model.updatedAt))
      && model.isGenerated
      && !model.performed
      && !model.lostToFollowUp;
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
                    { _id: person.id },
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

                // do not allow contact-contact relationships
                if (type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' && foundPerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                  throw app.utils.apiError.getError('INVALID_CONTACT_CONTACT_RELATIONSHIP', {
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

                // Set the person assignments (source/target)
                // If the trying to link to an event or a case, set it as the source.
                if (['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'].includes(data.persons[1].type)) {
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
      app.models.relationship.removeReadOnlyProperties(data);
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
   * Do not allow deletion of the last relationship of a contact with a case/event
   * @param personId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.helpers.deletePersonRelationship = function (personId, relationshipId, options, callback) {
    // initialize relationship instance; will be cached
    let relationshipInstance;

    app.models.relationship
      .findOne({
        where: {
          id: relationshipId,
          'persons.id': personId
        }
      })
      .then(function (relationship) {
        if (!relationship) {
          return {count: 0};
        }

        // cache relationship
        relationshipInstance = relationship;

        // check if the relationship includes a contact; if so the last relationship of a contact with a case/event cannot be deleted
        let relationshipContacts = relationship.persons.filter(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');
        if (relationshipContacts.length) {
          // there are contacts in the relationship; check their other relationships;
          // creating array of promises as the relation might be contact - contact
          let promises = [];
          relationshipContacts.forEach(function (contactEntry) {
            promises.push(
              // count contact relationships with case/events except the current relationship
              app.models.relationship
                .count({
                  id: {
                    neq: relationshipId
                  },
                  'persons.id': contactEntry.id,
                  'persons.type': {
                    in: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                  }
                })
                .then(function (relNo) {
                  if (!relNo) {
                    // no other relationships with case/event exist for the contact; return the contactId to return it in an error message
                    return contactEntry.id;
                  } else {
                    return;
                  }
                })
            );
          });

          // execute promises
          return Promise.all(promises);
        } else {
          return;
        }
      })
      .then(function (result) {
        // result can be undefined / object with count / array with contact ID elements to undefined elements
        // for array of contact IDs need to throw error
        if (typeof result === 'undefined') {
          // delete relationship
          return relationshipInstance.destroy(options);
        } else if (typeof result.count !== 'undefined') {
          return result;
        } else {
          // result is an array
          // get contact IDs from result if they exist
          let contactIDs = result.filter(entry => typeof entry !== 'undefined');

          // if result doesn't contain contact IDs the relationship will be deleted
          if (!contactIDs.length) {
            // delete relationship
            return relationshipInstance.destroy(options);
          } else {
            // there are contacts with no other relationships with case/event; error
            throw app.utils.apiError.getError('DELETE_CONTACT_LAST_RELATIONSHIP', {
              contactIDs: contactIDs.join(', ')
            });
          }
        }
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
   * @param type
   * @param context
   * @param modelInstance
   * @param next
   * @return {*}
   */
  Outbreak.helpers.attachFilterPeopleWithoutRelation = function (type, context, modelInstance, next) {
    // get custom noRelationships filter
    const noRelationship = _.get(context, 'args.filter.where.noRelationships', false);
    // remove custom filter before it reaches the model
    _.unset(context, 'args.filter.where.noRelationships');

    if (noRelationship) {
      // Retrieve all relationships of requested type for the given outbreak
      // Then filter cases based on relations count
      app.models.relationship
        .rawFind({
          outbreakId: context.instance.id,
          'persons.type': type
        }, {
          projection: {persons: 1}
        })
        // build list of people that have relationships in the given outbreak
        .then((relations) => [].concat(...relations.map((relation) => relation.persons.map(((person) => person.id)))))
        .then((peopleWithRelation) => {
          // attach additional filtering for cases that have no relationships
          context.args.filter = app.utils.remote
            .mergeFilters({
              where: {
                id: {
                  nin: peopleWithRelation
                }
              }
            }, context.args.filter);

          return next();
        })
        .catch(next);
    } else {
      return next();
    }
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
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'contact_list'
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
   * Count the contacts by follow-up filter
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param options Object containing outbreakId, follow-up flag name and result property
   * @param filter
   * @param callback
   */
  Outbreak.helpers.countContactsByFollowUpFilter = function (options, filter, callback) {
    filter = filter || {};
    // get options
    let resultProperty = options.resultProperty;

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
                  outbreakId: options.outbreakId,
                  deleted: {
                    $ne: true
                  }
                }
              ]
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return  [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: options.outbreakId,
              deleted: {
                $ne: true
              },
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
        // no contact query
        if (!contactQuery) {
          return;
        }

        // if a contact query was specified
        return app.models.contact
          .rawFind({and: [contactQuery, {outbreakId: options.outbreakId}]}, {projection: {_id: 1}})
          .then(function (contacts) {
            // return a list of contact ids
            return contacts.map(contact => contact.id);
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
                outbreakId: options.outbreakId
              },
              options.followUpFilter
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
        return app.models.followUp.rawFind(app.utils.remote
          .mergeFilters(followUpQuery, filter || {}).where)
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
   * @param callback
   */
  Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases = function (outbreak, filter, countOnly, callback) {
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

    // find the cases
    app.models.case
      .rawFind(_filter.where, {projection: {dateBecomeCase: 1}})
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
                  if (app.utils.helpers.getDate(relationship.contactDate) >= app.utils.helpers.getDate(caseRecord.dateBecomeCase)) {
                    relationshipIds.push(relationship.id);
                  }
                });
              }
            });
            // build/count transmission chains starting from the found relationIds
            app.models.relationship.buildOrCountTransmissionChains(outbreak.id, outbreak.periodOfFollowup, app.utils.remote.mergeFilters({
              where: {
                id: {
                  inq: relationshipIds
                }
              }
            }, filter || {}), countOnly, false, callback);
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
        baseProps[arrayProp] = baseProps[arrayProp].concat(...
          people
            .filter((item) => item[arrayProp])
            .map((item) => item[arrayProp])
        );
      });
    }

    // merge all contact array props
    if (type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
      contactArrayProps.forEach((arrayProp) => {
        baseProps[arrayProp] = baseProps[arrayProp] || [];
        baseProps[arrayProp] = baseProps[arrayProp].concat(...
          people
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
   * Hide fields that the user does not have permission to see on a person model (case/contact/event)
   * @param model
   * @param permissions
   */
  Outbreak.helpers.limitPersonInformation = function (model, permissions) {
    const personReadPermissionMap = {
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'contact_list',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'case_list',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'event_list'
    };

    if (
      permissions.indexOf(personReadPermissionMap[model.type]) === -1 && (
        !app.models.role.permissionGroupMap ||
        !app.models.role.permissionGroupMap[personReadPermissionMap[model.type]] ||
        permissions.indexOf(app.models.role.permissionGroupMap[personReadPermissionMap[model.type]].groupAllId) === -1
      )
    ) {
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
      qAnswer = qAnswer.find(a => genericHelpers.getDate(a.date).format('YYYY-MM-DD') === question.multiAnswerDate);
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
      if (qAnswer instanceof Date || genericHelpers.isValidDate(qAnswer)) {
        question.value = genericHelpers.getDateDisplayValue(qAnswer);
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
            clonedQ.multiAnswerDate = genericHelpers.getDate(answer.date).format('YYYY-MM-DD');
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
   * @param callback
   */
  Outbreak.prototype.findOrCountPeopleInCluster = function (clusterId, filter, countOnly, callback) {
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
        cluster.findOrCountPeople(filter, countOnly, callback);
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
    ['caseInvestigationTemplate', 'contactFollowUpTemplate', 'labResultsTemplate'].forEach(function (template) {
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
      // validate its uniqueness
      return Outbreak.helpers
        .validateVisualIdUniqueness(outbreak.id, visualId, personId)
        .then(() => {
          // get the next available visual id for the visual id template
          return Outbreak.helpers
            .getAvailableVisualId(outbreak, (personType === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ? 'caseIdMask' : 'contactIdMask'), visualId, personId);
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
          let archiveName = `caseInvestigationTemplates_${moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
          let archivePath = `${tmpDirName}/${archiveName}`;
          let zip = new AdmZip();

          zip.addLocalFolder(tmpDirName);
          zip.writeZip(archivePath);

          fs.readFile(archivePath, (err, data) => {
            if (err) {
              callback(err);
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
   * Create multiple contacts for case/event
   * @param outbreak Outbreak instance
   * @param modelName case/event
   * @param modelId caseId/eventId
   * @param data
   * @param options
   * @return {Promise<any>}
   */
  Outbreak.createPersonMultipleContacts = function (outbreak, modelName, modelId, data, options) {
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
   * Modify multiple contacts
   * @param existingContacts
   * @return {Promise<any>}
   */
  Outbreak.modifyMultipleContacts = function (existingContacts) {
    // reference shortcuts
    const getError = app.utils.apiError.getError;
    const contactModel = app.models.contact;

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
                .updateAttributes(existingContact)
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
};
