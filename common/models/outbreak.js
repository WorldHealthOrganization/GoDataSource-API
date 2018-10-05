'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const genericHelpers = require('../../components/helpers');
const templateParser = require('./../../components/templateParser');

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
    'arcGisServers': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVERS',
    'arcGisServers[].name': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_NAME',
    'arcGisServers[].url': 'LNG_OUTBREAK_FIELD_LABEL_ARC_GIS_SERVER_URL'
  });

  Outbreak.referenceDataFieldsToCategoryMap = {
    disease: 'LNG_REFERENCE_DATA_CATEGORY_DISEASE',
    'countries[].id': 'LNG_REFERENCE_DATA_CATEGORY_COUNTRY'
  };

  Outbreak.referenceDataFields = Object.keys(Outbreak.referenceDataFieldsToCategoryMap);

  // initialize model helpers
  Outbreak.helpers = {};
  // set a higher limit for event listeners to avoid warnings (we have quite a few listeners)
  Outbreak.setMaxListeners(60);

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
   * @param personId
   * @param type
   * @param data
   * @param callback
   * @return {*}
   */
  Outbreak.helpers.validateAndNormalizePeople = function (personId, type, data, callback) {
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
            app.models.person
              .findById(person.id)
              .then(function (foundPerson) {
                if (!foundPerson) {
                  throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                    model: app.models.person.modelName,
                    id: person.id
                  });
                }

                // do not allow event-event relationships
                if (type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT' && foundPerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT') {
                  throw app.utils.apiError.getError('INVALID_EVENT_EVENT_RELATIONSHIP', {
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
                  !app.models.case.nonDiscardedCaseClassifications.includes(foundPerson.classification)
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
    Outbreak.helpers.validateAndNormalizePeople(personId, type, data, function (error) {
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
        callback(null, relationship);
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
    Outbreak.helpers.validateAndNormalizePeople(personId, type, data, function (error) {
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
        }
        else if (typeof result.count !== 'undefined') {
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
        .find({
          fields: ['persons'],
          where: {
            outbreakId: context.instance.id,
            'persons.type': type
          }
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
   * Get the next available visual id
   * @param outbreak
   * @param visualId
   * @param [personId]
   * @return {*}
   */
  Outbreak.helpers.getAvailableVisualId = function (outbreak, visualId, personId) {
    // get search regex for visual id template
    let maskRegExp = app.utils.maskField.convertMaskToSearchRegExp(outbreak.caseIdMask, visualId);
    // if no search regex returned
    if (!maskRegExp) {
      // invalid mask error
      return Promise.reject(app.utils.apiError.getError('INVALID_VISUAL_ID_MASK', {
        visualIdTemplate: visualId,
        outbreakVisualIdMask: outbreak.caseIdMask
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
              index = app.utils.maskField.extractValueFromMaskedField(outbreak.caseIdMask, person.visualId);
            }
            // get next index
            index++;
            // resolve the mask using the computed index
            return app.utils.maskField.resolveMask(outbreak.caseIdMask, visualId, index);
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
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'read_case',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'read_case',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'read_contact'
    };
    // if the required permission is missing
    if (permissions.indexOf(requiredPermissionMap[type]) === -1) {
      // use restricted field
      filter = createRestrictedFilter(filter, [...Outbreak.noPersonReadPermissionFields, 'relationships', 'persons', 'people']);
      // update filter
      _.set(context, 'args.filter', filter);
    }
  };

  /**
   * Count the contacts by follow-up flag (eg: performed, lostToFollowUp)
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param options Object containing outbreakId, follow-up flag name and result property
   * @param filter
   * @param callback
   */
  Outbreak.helpers.countContactsByFollowUpFlag = function (options, filter, callback) {
    // get options
    let followUpFlag = options.followUpFlag;
    let resultProperty = options.resultProperty;

    // initialize result
    let results = {
      [resultProperty]: 0,
      contactIDs: [],
      teams: []
    };

    // get all the followups for the filtered period
    app.models.followUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: options.outbreakId
        }
      }, filter || {}))
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

        // initialize map of contacts to not count same contact twice
        let contacts = {};
        // initialize map of teams
        let teams = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;
          // get teamId; there might be no team id, set null
          let teamId = followup.teamId || null;

          // check if a followup for the same contact was already parsed
          if (contacts[contactId]) {
            // check if there was another followup for the same team
            // if so check for the cached follow-up flag value; eg: check for the cached lostToFollowUp flag
            // if the previous followup flag was true there is no need to update any counter;
            // counter will not be incremented even though the new followup flag was also true; eg: will not increment even though the new follow-up is also lostToFollowUp
            // updates needed only for the case where the previous followup flag was false and the current one is true; eg: previous follow-up was not lostToFollowUp and the current one is
            if (contacts[contactId].teams[teamId]) {
              if (!contacts[contactId].teams[teamId][followUpFlag] && followup[followUpFlag] === true) {
                // update follow-up flag
                contacts[contactId].teams[teamId][followUpFlag] = true;
                // increase counter for team
                teams[teamId][resultProperty]++;
                // add contact ID in list of IDs
                teams[teamId].contactIDs.push(followup.personId);
              }
            } else {
              // new teamId
              // cache followup flag information for contact in team
              contacts[contactId].teams[teamId] = {
                [followUpFlag]: followup[followUpFlag]
              };

              // initialize team entry if doesn't already exist
              teams[teamId] = teams[teamId] || {
                id: teamId,
                contactIDs: [],
                [resultProperty]: 0
              };

              // increase counter for the team
              if (followup[followUpFlag]) {
                teams[teamId][resultProperty]++;
                // add contact ID in list of IDs
                teams[teamId].contactIDs.push(followup.personId);
              }
            }

            // check if the previous flag value was  false and the current one is true
            // eg: check if contact didn't have a lostToFollowUp followup and the current one was lostToFollowUp
            // as specified above for teams this is the only case where updates are needed
            if (!contacts[contactId][followUpFlag] && followup[followUpFlag] === true) {
              // update overall follow-up flag
              contacts[contactId][followUpFlag] = true;
              // increase successful total counter
              results[resultProperty]++;
              // add contact ID in list of IDs
              results.contactIDs.push(followup.personId);
            }
          } else {
            // first followup for the contact
            // cache followup flag information for contact in team and overall; eg: cache lostToFollowUp flag
            contacts[contactId] = {
              teams: {
                [teamId]: {
                  [followUpFlag]: followup[followUpFlag]
                }
              },
              [followUpFlag]: followup[followUpFlag]
            };

            // initialize team entry if doesn't already exist
            teams[teamId] = teams[teamId] || {
              id: teamId,
              contactIDs: [],
              [resultProperty]: 0
            };

            // increase counters if the follow-up flag is true; add contact ID in list of IDs
            // eg: if the contact was lost to follow-up
            if (followup[followUpFlag]) {
              results[resultProperty]++;
              results.contactIDs.push(followup.personId);
              teams[teamId][resultProperty]++;
              teams[teamId].contactIDs.push(followup.personId);
            }
          }
        });

        // update results.teams; sending array with teams information only for the teams that have contacts
        results.teams = _.values(teams).filter(teamEntry => teamEntry[resultProperty]);

        // send response
        callback(null, results);
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
          dateBecomeCase: {
            neq: null
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
    // find the cases
    app.models.case
      .find(_filter)
      .then(function (cases) {
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
              if ((new Date(relationship.contactDate)) > (new Date(caseRecord.dateBecomeCase))) {
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
        }, filter || {}), countOnly, callback);
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
      'riskReason'
    ];
    const caseProps = [
      'dateOfInfection',
      'dateOfOnset',
      'isDateOfOnsetApproximate',
      'dateBecomeCase',
      'dateOfOutcome',
      'deceased',
      'dateDeceased',
      'classification',
      'riskLevel',
      'riskReason',
      'transferRefused',
      'dateOfReporting',
      'isDateOfReportingApproximate'
    ];
    // the following case props are array and should be treated differently
    const caseArrayProps = [
      'isolationDates',
      'hospitalizationDates',
      'incubationDates',
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
   * Parse a outbreak template's questions by translating any tokens based on given dictionary reference
   * Function works recursive by translating any additional questions of the answers
   * @param questions
   * @param dictionary
   */
  Outbreak.helpers.parseTemplateQuestions = function (questions, dictionary) {
    // cache translation function name, used in many places below
    // include sanity check, fallback on initial value if no translation is found
    let translateToken = function (text) {
      let translatedText = dictionary.getTranslation(text);
      return translatedText ? translatedText : text;
    };

    // Translate all the questions, including additional questions of the answers
    return (function translate(list) {
      return list.map((question) => {
        let questionResult = {
          order: question.order,
          question: translateToken(question.text),
          variable: question.variable,
          answerType: question.answerType,
          answers: question.answers
        };

        // do not try to translate answers that are free text
        if (question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER'
          || question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
          questionResult.answers = question.answers.map((answer) => {
            return {
              label: translateToken(answer.label),
              value: answer.value,
              additionalQuestions: translate(answer.additionalQuestions || [])
            };
          });
        }

        return questionResult;
      });
    })(_.filter(questions, question => question.answerType !== 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD'));
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
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'read_contact',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'read_case',
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'read_case'
    };

    if (permissions.indexOf(personReadPermissionMap[model.type]) === -1) {
      for (let key in model) {
        if (Outbreak.noPersonReadPermissionFields.indexOf(key) === -1) {
          delete model[key];
        }
      }
    }
  };

  /**
   * Format the questions object for easier printing
   * @param answers
   * @param questions
   */
  Outbreak.helpers.prepareQuestionsForPrint = function (answers, questions) {
    Object.keys(answers).forEach((key) => {
      let question = _.find(questions, (question) => {
        return question.variable === key;
      });

      if (question && question.answers) {
        question.answers.forEach((answer) => {
          if (answers[key].indexOf(answer.value) !== -1) {
            answer.selected = true;
          }

          if (answer.additionalQuestions && answer.additionalQuestions.length) {
            Outbreak.helpers.prepareQuestionsForPrint(answers, answer.additionalQuestions);
          }
        });
      } else if (question && !question.answers) {
        if (answers[key] instanceof Date || genericHelpers.isValidDate(answers[key])) {
          question.value = genericHelpers.getDateDisplayValue(answers[key]);
        } else {
          question.value = answers[key];
        }
      }
    });
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
    templateParser.afterHook(context, next);
  });

  /**
   * Resolve person visual id template, if visualId field present
   * @param outbreak
   * @param visualId
   * @param [personId]
   * @return {*}
   */
  Outbreak.helpers.resolvePersonVisualIdTemplate = function (outbreak, visualId, personId) {
    // if the field is present
    if (typeof visualId === 'string' && visualId.length) {
      // get the next available visual id for the visual id template
      return Outbreak.helpers
        .getAvailableVisualId(outbreak, visualId, personId)
        .then(function (visualId) {
          // validate its uniqueness
          return Outbreak.helpers.validateVisualIdUniqueness(outbreak.id, visualId, personId);
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
   * @param foundCase
   * @param options
   * @param callback
   */
  Outbreak.helpers.printCaseInvestigation = function (outbreakInstance, pdfUtils, foundCase, options, callback) {
    const models = app.models;
    let caseInvestigationTemplate = outbreakInstance.caseInvestigationTemplate;
    let labResultsTemplate = outbreakInstance.labResultsTemplate;

    // authenticated user's language, used to know in which language to translate
    let languageId = options.remotingContext.req.authData.userInstance.languageId;

    // load user language dictionary
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      // handle errors
      if (error) {
        return callback(error);
      }

      // translate case, lab results, contact fields
      let caseModel = Object.assign({}, models.case.fieldLabelsMap);
      let contactModel = Object.assign({}, models.contact.fieldLabelsMap);

      // remove array properties from model definition (they are handled separately)
      Object.keys(caseModel).forEach(function (property) {
        if (property.indexOf('[]') !== -1) {
          delete caseModel[property];
        }
      });

      caseModel.addresses = [models.address.fieldLabelsMap];
      caseModel.documents = [models.document.fieldLabelsMap];

      contactModel.addresses = [models.address.fieldLabelsMap];
      contactModel.documents = [models.document.fieldLabelsMap];

      let caseFields = genericHelpers.translateFieldLabels(app, caseModel, models.case.modelName, dictionary);
      let contactFields = genericHelpers.translateFieldLabels(app, contactModel, models.contact.modelName, dictionary);

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

      // generate pdf document
      let doc = pdfUtils.createPdfDoc({
        fontSize: 11,
        layout: 'portrait'
      });

      // add a top margin of 2 lines for each page
      doc.on('pageAdded', () => {
        doc.moveDown(2);
      });

      // set margin top for first page here, to not change the entire createPdfDoc functionality
      doc.moveDown(2);

      if (foundCase) {
        let qrCode = app.utils.qrCode.createResourceLink('case', {
          outbreakId: outbreakInstance.id,
          caseId: 'caseId'
        });
        doc.image(qrCode, 480, 15, {width: 100, height: 100});

        // add case profile fields (empty)
        pdfUtils.displayModelDetails(doc, caseFields, false, `${foundCase.firstName} ${foundCase.middleName} ${foundCase.lastName}`);
      } else {
        // add case profile fields (empty)
        pdfUtils.displayModelDetails(doc, caseFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_CASE_DETAILS'));
      }

      // add case investigation questionnaire into the pdf in a separate page
      doc.addPage();
      pdfUtils.createQuestionnaire(doc, caseQuestions, false, dictionary.getTranslation('LNG_PAGE_TITLE_CASE_QUESTIONNAIRE'));

      // add lab results information into a separate page
      doc.addPage();
      pdfUtils.displayModelDetails(doc, labResultsFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_DETAILS'));
      doc.addPage();
      pdfUtils.createQuestionnaire(doc, labQuestions, false, dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_QUESTIONNAIRE'));

      // add contact relation template
      doc.addPage();
      pdfUtils.displayModelDetails(doc, contactFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'));
      pdfUtils.displayModelDetails(doc, relationFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_RELATIONSHIP'));

      // end the document stream
      // to convert it into a buffer
      doc.end();

      // convert pdf stream to buffer and send it as response
      genericHelpers.streamToBuffer(doc, (err, buffer) => {
        if (err) {
          callback(err);
        } else {
          app.utils.remote.helpers.offerFileToDownload(buffer, 'application/pdf', 'case_investigation.pdf', callback);
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
   * Query contacts using a series of custom filters and return their ids as an array
   * @param filter
   * @param outbreakId
   * @returns {Promise.<TResult>}
   */
  Outbreak.helpers.buildFollowUpCustomFilter = function (filter, outbreakId) {
    if (filter && typeof(filter) === 'object' && Object.keys(filter).length !== 0) {
      let caseFilter, relationshipFilter, contactFilter;
      caseFilter = relationshipFilter = contactFilter = {};
      let weekNumber = 0;
      let timeLastSeen = '';

      if (filter.whereCase) {
        // Build the case filter
        caseFilter = app.utils.remote.mergeFilters({
          where: {
            'type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
          },
          filterParent: true
        }, filter.whereCase ? {where: filter.whereCase} : {});
        delete filter.whereCase;
      }

      if (filter.whereRelationship || Object.keys(caseFilter).length !== 0) {
        // Build the relationship filter
        relationshipFilter = filter.whereRelationship || {};

        if (Object.keys(caseFilter).length !== 0) {
          relationshipFilter = app.utils.remote.mergeFilters({
            where: {
              'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
            },
            include: {
              relation: 'people',
              scope: caseFilter
            },
            filterParent: true
          }, filter.whereRelationship ? {where: filter.whereRelationship} : {});
        }
        delete filter.whereRelationship;
      }

      // Start building the contact filter
      let additionalContactFilter = {
        where: {
          outbreakId: outbreakId
        }
      };

      // If there is a time filter, get the contact's latest performed follow-up
      if (filter.where.timeLastSeen) {
        // Cache timeLastSeen filter
        timeLastSeen = filter.where.timeLastSeen;

        additionalContactFilter.include = {
          relation: 'followUps',
          scope: {
            where: {
              performed: true
            },
            order: 'date DESC',
            limit: 1
          }
        };
        delete filter.where.timeLastSeen;
      }

      // Build the contact filter
      if (filter.whereContact) {
        contactFilter = app.utils.remote.mergeFilters(additionalContactFilter, filter.whereContact ? {where: filter.whereContact} : {});
        delete filter.whereContact;
      }

      if (filter.where.weekNumber) {
        // Cache the week filter
        weekNumber = filter.where.weekNumber;
        delete filter.where.weekNumber;
      }

      // Include relationships only if necessary
      if (Object.keys(caseFilter).length !== 0 || Object.keys(relationshipFilter).length !== 0) {
        contactFilter = app.utils.remote.mergeFilters({
          include: {
            relation: 'relationships',
            scope: relationshipFilter,
          }
        }, contactFilter);
      }

      // If any custom filters have been mentioned
      if (contactFilter && Object.keys(contactFilter).length !== 0) {
        return app.models.contact.find(contactFilter)
          .then((contacts) => {
            // Remove any contacts that have empty relations
            contacts = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(contacts, contactFilter);

            // If necessary, get only contacts that have last been seen before the specified date.
            if (timeLastSeen && moment(timeLastSeen).isValid()) {
              contacts = _.filter(contacts, function (contact) {
                if (contact.followUps) {
                  return moment(contact.followUps[0].date).isBefore(timeLastSeen, 'day');
                } else {
                  return false;
                }
              });
            }

            let contactIds = contacts.map(contact => contact.id);

            let finalFilter = {
              where: {
                personId: {
                  inq: contactIds
                }
              }
            };

            // If there was a week filter, make sure to request only follow-ups that are happening in
            // the requested week of the follow-up period
            if (weekNumber > 0) {
              finalFilter.where.index = {
                between: [(weekNumber - 1) * 7 + 1, weekNumber * 7]
              };
            }

            // If we have a time filter, make sure to request follow-ups that are scheduled after the requested
            // date. The other requirements of the filter (having a last seen date before the one in the filter)
            // has been handled in the getContactIdsFromCustomFilters function
            if (timeLastSeen) {
              finalFilter.where.date = {
                gt: timeLastSeen
              };
            }

            return finalFilter;
          });
      } else {
        // If the filter is only follow-up related
        return Promise.resolve(filter);
      }
    } else {
      // If no filter is mentioned
      return Promise.resolve(filter);
    }
  };
};
